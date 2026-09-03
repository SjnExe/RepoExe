/*
 * librepoexe_override.c - RepoExe Native Package Interceptor
 * Intercepts execve/posix_spawn for node_modules/.bin and .venv/bin calls
 * and transparently redirects to native RepoExe system package binaries when
 * version ranges match.
 */

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <dirent.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/types.h>

#define MAX_PATH 4096
#define MAX_VERSION 64

static const char *get_prefix(void) {
    const char *p = getenv("PREFIX");
    if (p && p[0]) return p;
    p = getenv("TERMUX_PREFIX");
    if (p && p[0]) return p;
    return "/data/data/com.termux/files/usr";
}

static int extract_json_field(const char *json, const char *key, char *out_val, size_t max_len) {
    if (!json || !key || !out_val || max_len == 0) return 0;
    out_val[0] = '\0';

    char search_key[128];
    snprintf(search_key, sizeof(search_key), "\"%s\"", key);

    const char *p = strstr(json, search_key);
    if (!p) return 0;

    p += strlen(search_key);
    const char *colon = strchr(p, ':');
    if (!colon) return 0;

    const char *q1 = strchr(colon, '"');
    if (!q1) return 0;

    const char *q2 = strchr(q1 + 1, '"');
    if (!q2) return 0;

    size_t len = (size_t)(q2 - (q1 + 1));
    if (len >= max_len) len = max_len - 1;
    strncpy(out_val, q1 + 1, len);
    out_val[len] = '\0';
    return 1;
}

/* Very simple SemVer / version comparison: returns 1 if v1 >= v2, 0 otherwise */
static int parse_version_numbers(const char *v_str, int *major, int *minor, int *patch) {
    *major = 0; *minor = 0; *patch = 0;
    if (!v_str) return 0;
    while (*v_str && (*v_str < '0' || *v_str > '9')) v_str++;
    if (!*v_str) return 0;
    if (sscanf(v_str, "%d.%d.%d", major, minor, patch) >= 1) return 1;
    return 0;
}

static int compare_versions(const char *v1, const char *v2) {
    int maj1 = 0, min1 = 0, pat1 = 0;
    int maj2 = 0, min2 = 0, pat2 = 0;
    parse_version_numbers(v1, &maj1, &min1, &pat1);
    parse_version_numbers(v2, &maj2, &min2, &pat2);

    if (maj1 != maj2) return maj1 - maj2;
    if (min1 != min2) return min1 - min2;
    return pat1 - pat2;
}

/* Check if project version satisfies patched_version_range (e.g. ">=5.0.0", "^5.0.0", "~5.0.0", "5.x") */
static int version_satisfies_range(const char *proj_ver, const char *range, const char *channel_name) {
    if (!proj_ver || !proj_ver[0]) return 0;

    int p_maj = 0, p_min = 0, p_pat = 0;
    if (!parse_version_numbers(proj_ver, &p_maj, &p_min, &p_pat)) return 0;

    if (range && range[0]) {
        if (range[0] == '^') {
            int r_maj = 0, r_min = 0, r_pat = 0;
            if (parse_version_numbers(range + 1, &r_maj, &r_min, &r_pat)) {
                if (p_maj == r_maj && compare_versions(proj_ver, range + 1) >= 0) return 1;
            }
        } else if (range[0] == '~') {
            int r_maj = 0, r_min = 0, r_pat = 0;
            if (parse_version_numbers(range + 1, &r_maj, &r_min, &r_pat)) {
                if (p_maj == r_maj && p_min == r_min && compare_versions(proj_ver, range + 1) >= 0) return 1;
            }
        } else if (strncmp(range, ">=", 2) == 0) {
            if (compare_versions(proj_ver, range + 2) >= 0) return 1;
        } else if (strncmp(range, ">", 1) == 0) {
            if (compare_versions(proj_ver, range + 1) > 0) return 1;
        } else if (range[0] == '=') {
            if (compare_versions(proj_ver, range + 1) == 0) return 1;
        }
    }

    /* Fallback channel match if range not specified */
    if (channel_name && channel_name[0]) {
        if (strcmp(channel_name, "latest") == 0) return 1;

        int c_maj = 0, c_min = 0, c_pat = 0;
        int parsed_count = sscanf(channel_name, "%d.%d.%d", &c_maj, &c_min, &c_pat);
        if (parsed_count == 1) {
            if (p_maj == c_maj) return 1;
        } else if (parsed_count == 2) {
            if (p_maj == c_maj && p_min == c_min) return 1;
        } else if (parsed_count == 3) {
            if (p_maj == c_maj && p_min == c_min && p_pat == c_pat) return 1;
        }
    }

    return 0;
}

/* Read package version from node_modules/<tool>/package.json */
static int get_node_module_version(const char *bin_path, const char *tool, char *out_ver, size_t max_len) {
    char manifest_path[MAX_PATH];
    const char *bin_pos = strstr(bin_path, "node_modules/.bin/");
    if (!bin_pos) bin_pos = strstr(bin_path, "node_modules/bin/");
    if (!bin_pos) return 0;

    size_t prefix_len = bin_pos - bin_path;
    snprintf(manifest_path, sizeof(manifest_path), "%.*snode_modules/%s/package.json", (int)prefix_len, bin_path, tool);

    int fd = open(manifest_path, O_RDONLY);
    if (fd < 0) return 0;

    char buf[4096];
    ssize_t n = read(fd, buf, sizeof(buf) - 1);
    close(fd);
    if (n <= 0) return 0;
    buf[n] = '\0';

    return extract_json_field(buf, "version", out_ver, max_len);
}

/* Read package version from .venv or venv dist-info */
static int get_python_venv_version(const char *bin_path, const char *tool, char *out_ver, size_t max_len) {
    const char *v_pos = strstr(bin_path, ".venv/bin/");
    if (!v_pos) v_pos = strstr(bin_path, "venv/bin/");
    if (!v_pos) return 0;

    size_t prefix_len = v_pos - bin_path;
    char search_dir[MAX_PATH];
    snprintf(search_dir, sizeof(search_dir), "%.*s.venv/lib", (int)prefix_len, bin_path);

    DIR *d = opendir(search_dir);
    if (!d) {
        snprintf(search_dir, sizeof(search_dir), "%.*svenv/lib", (int)prefix_len, bin_path);
        d = opendir(search_dir);
    }
    if (!d) return 0;

    struct dirent *entry;
    char site_packages[MAX_PATH] = "";
    while ((entry = readdir(d)) != NULL) {
        if (strncmp(entry->d_name, "python", 6) == 0) {
            snprintf(site_packages, sizeof(site_packages), "%s/%s/site-packages", search_dir, entry->d_name);
            break;
        }
    }
    closedir(d);
    if (!site_packages[0]) return 0;

    DIR *sp_d = opendir(site_packages);
    if (!sp_d) return 0;

    char meta_path[MAX_PATH] = "";
    while ((entry = readdir(sp_d)) != NULL) {
        if (strstr(entry->d_name, ".dist-info") && strncmp(entry->d_name, tool, strlen(tool)) == 0) {
            snprintf(meta_path, sizeof(meta_path), "%s/%s/METADATA", site_packages, entry->d_name);
            break;
        }
    }
    closedir(sp_d);
    if (!meta_path[0]) return 0;

    int fd = open(meta_path, O_RDONLY);
    if (fd < 0) return 0;

    char buf[4096];
    ssize_t n = read(fd, buf, sizeof(buf) - 1);
    close(fd);
    if (n <= 0) return 0;
    buf[n] = '\0';

    char *v_line = strstr(buf, "Version: ");
    if (!v_line) return 0;

    v_line += 9;
    char *eol = strchr(v_line, '\n');
    size_t len = eol ? (size_t)(eol - v_line) : strlen(v_line);
    if (len >= max_len) len = max_len - 1;
    strncpy(out_ver, v_line, len);
    out_ver[len] = '\0';
    return 1;
}

typedef struct {
    char pkg_name[128];
    char binary_path[MAX_PATH];
    char version[MAX_VERSION];
    char patched_range[128];
    char channel[64];
    int is_latest;
} CandidatePkg;

/* Find best native override system binary for tool */
static int resolve_native_override(const char *tool, const char *proj_ver, char *out_binary_path, size_t max_len) {
    const char *prefix = get_prefix();
    char manifest_dir[MAX_PATH];
    snprintf(manifest_dir, sizeof(manifest_dir), "%s/share/repoexe/manifests", prefix);

    DIR *d = opendir(manifest_dir);
    if (!d) return 0;

    CandidatePkg candidates[32];
    int candidate_count = 0;

    size_t tool_len = strlen(tool);
    struct dirent *entry;
    while ((entry = readdir(d)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        if (!strstr(entry->d_name, ".json")) continue;

        /* Ensure exact tool prefix match e.g. tool="tsc" matches "tsc.json" or "tsc-7.json", but not "tscpd.json" */
        if (strncmp(entry->d_name, tool, tool_len) != 0) continue;
        char next_c = entry->d_name[tool_len];
        if (next_c != '.' && next_c != '-') continue;

        char m_path[MAX_PATH];
        snprintf(m_path, sizeof(m_path), "%s/%s", manifest_dir, entry->d_name);
        int fd = open(m_path, O_RDONLY);
        if (fd < 0) continue;

        char buf[2048];
        ssize_t n = read(fd, buf, sizeof(buf) - 1);
        close(fd);
        if (n <= 0) continue;
        buf[n] = '\0';

        CandidatePkg cand;
        memset(&cand, 0, sizeof(cand));

        /* Extract fields from manifest JSON using extract_json_field */
        char pkg_name_buf[128] = "";
        extract_json_field(buf, "name", pkg_name_buf, sizeof(pkg_name_buf));
        if (!pkg_name_buf[0]) {
            strncpy(pkg_name_buf, entry->d_name, strlen(entry->d_name) - 5);
        }

        snprintf(cand.binary_path, sizeof(cand.binary_path), "%s/bin/%s", prefix, pkg_name_buf);
        if (access(cand.binary_path, X_OK) != 0) {
            /* Try base tool binary */
            snprintf(cand.binary_path, sizeof(cand.binary_path), "%s/bin/%s", prefix, tool);
            if (access(cand.binary_path, X_OK) != 0) continue;
        }

        strncpy(cand.pkg_name, pkg_name_buf, sizeof(cand.pkg_name) - 1);

        extract_json_field(buf, "version", cand.version, sizeof(cand.version));
        extract_json_field(buf, "patched_version_range", cand.patched_range, sizeof(cand.patched_range));
        extract_json_field(buf, "channel", cand.channel, sizeof(cand.channel));

        if (strcmp(cand.channel, "latest") == 0 || strcmp(cand.pkg_name, tool) == 0) {
            cand.is_latest = 1;
        }

        if (version_satisfies_range(proj_ver, cand.patched_range, cand.channel)) {
            if (candidate_count < 32) {
                candidates[candidate_count++] = cand;
            }
        }
    }
    closedir(d);

    if (candidate_count == 0) return 0;

    /* Priority rule:
     * 1. If latest channel satisfies range, latest takes priority.
     * 2. Otherwise, select candidate with highest version.
     */
    int best_idx = -1;
    for (int i = 0; i < candidate_count; i++) {
        if (candidates[i].is_latest) {
            best_idx = i;
            break;
        }
    }

    if (best_idx == -1) {
        best_idx = 0;
        for (int i = 1; i < candidate_count; i++) {
            if (compare_versions(candidates[i].version, candidates[best_idx].version) > 0) {
                best_idx = i;
            }
        }
    }

    strncpy(out_binary_path, candidates[best_idx].binary_path, max_len - 1);
    out_binary_path[max_len - 1] = '\0';
    return 1;
}

static const char *check_and_get_override(const char *filename, char *out_buf, size_t buf_size) {
    if (!filename) return filename;

    int is_node = (strstr(filename, "node_modules/.bin/") != NULL || strstr(filename, "node_modules/bin/") != NULL);
    int is_venv = (strstr(filename, ".venv/bin/") != NULL || strstr(filename, "venv/bin/") != NULL);

    if (!is_node && !is_venv) return filename;

    const char *slash = strrchr(filename, '/');
    const char *tool = slash ? slash + 1 : filename;
    if (!tool || !tool[0]) return filename;

    char proj_ver[MAX_VERSION] = "";
    int ver_found = 0;

    if (is_node) {
        ver_found = get_node_module_version(filename, tool, proj_ver, sizeof(proj_ver));
    } else if (is_venv) {
        ver_found = get_python_venv_version(filename, tool, proj_ver, sizeof(proj_ver));
    }

    if (!ver_found || !proj_ver[0]) return filename;

    if (resolve_native_override(tool, proj_ver, out_buf, buf_size)) {
        return out_buf;
    }

    return filename;
}

typedef int (*execve_fn)(const char *, char *const [], char *const []);

int execve(const char *filename, char *const argv[], char *const envp[]) {
    execve_fn real_execve = (execve_fn)dlsym(RTLD_NEXT, "execve");
    if (!real_execve) return -1;

    char override_buf[MAX_PATH];
    const char *target = check_and_get_override(filename, override_buf, sizeof(override_buf));

    return real_execve(target, argv, envp);
}

int execv(const char *filename, char *const argv[]) {
    extern char **environ;
    execve_fn real_execve = (execve_fn)dlsym(RTLD_NEXT, "execve");
    if (!real_execve) return -1;

    char override_buf[MAX_PATH];
    const char *target = check_and_get_override(filename, override_buf, sizeof(override_buf));

    return real_execve(target, argv, environ);
}

int execvp(const char *filename, char *const argv[]) {
    typedef int (*execvp_fn)(const char *, char *const []);
    execvp_fn real_execvp = (execvp_fn)dlsym(RTLD_NEXT, "execvp");

    char override_buf[MAX_PATH];
    const char *target = check_and_get_override(filename, override_buf, sizeof(override_buf));

    if (real_execvp) {
        return real_execvp(target, argv);
    }
    return -1;
}

int execvpe(const char *filename, char *const argv[], char *const envp[]) {
    typedef int (*execvpe_fn)(const char *, char *const []);
    execvpe_fn real_execvpe = (execvpe_fn)dlsym(RTLD_NEXT, "execvpe");

    char override_buf[MAX_PATH];
    const char *target = check_and_get_override(filename, override_buf, sizeof(override_buf));

    if (real_execvpe) {
        return real_execvpe(target, argv, envp);
    }
    return -1;
}

int posix_spawn(
    pid_t *pid,
    const char *path,
    const posix_spawn_file_actions_t *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[],
    char *const envp[]
) {
    typedef int (*posix_spawn_fn)(pid_t *, const char *, const posix_spawn_file_actions_t *, const posix_spawnattr_t *, char *const [], char *const []);
    posix_spawn_fn real_posix_spawn = (posix_spawn_fn)dlsym(RTLD_NEXT, "posix_spawn");

    if (!real_posix_spawn) return -1;

    char override_buf[MAX_PATH];
    const char *target = check_and_get_override(path, override_buf, sizeof(override_buf));

    return real_posix_spawn(pid, target, file_actions, attrp, argv, envp);
}

int posix_spawnp(
    pid_t *pid,
    const char *file,
    const posix_spawn_file_actions_t *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[],
    char *const envp[]
) {
    typedef int (*posix_spawnp_fn)(pid_t *, const char *, const posix_spawn_file_actions_t *, const posix_spawnattr_t *, char *const [], char *const []);
    posix_spawnp_fn real_posix_spawnp = (posix_spawnp_fn)dlsym(RTLD_NEXT, "posix_spawnp");

    if (!real_posix_spawnp) return -1;

    char override_buf[MAX_PATH];
    const char *target = check_and_get_override(file, override_buf, sizeof(override_buf));

    return real_posix_spawnp(pid, target, file_actions, attrp, argv, envp);
}
