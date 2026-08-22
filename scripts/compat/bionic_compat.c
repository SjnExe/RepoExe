#define _GNU_SOURCE 1
#define __USE_GNU 1
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <time.h>
#include <sys/time.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/syscall.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/mman.h>
#include <sys/uio.h>
#include <fcntl.h>
#include <unistd.h>
#include <pthread.h>
#include <signal.h>
#include <sched.h>
#include <ctype.h>
#include <wctype.h>
#include <wchar.h>
#include <locale.h>
#include <langinfo.h>
#include <netdb.h>
#include <dlfcn.h>
#include <link.h>
#include <math.h>
#include <errno.h>
#include <poll.h>
#include <sys/prctl.h>
#include <sys/system_properties.h>

#include "bionic_stub.h"

#undef __timezone
#undef timezone
#undef daylight
#undef __daylight
#undef tzname
#undef __tzname
#undef environ
#undef __environ
#undef bcopy
#undef bzero
#undef bcmp
#undef toupper
#undef tolower
#undef towupper
#undef towlower
#undef iswalpha
#undef iswdigit
#undef iswspace
#undef iswctype

#ifdef __cplusplus
extern "C" {
#endif

extern char **environ;
__attribute__((weak, visibility("default"))) long __timezone = 0;
__attribute__((weak, visibility("default"))) long timezone = 0;
__attribute__((weak, visibility("default"))) int daylight = 0;
__attribute__((weak, visibility("default"))) int __daylight = 0;
__attribute__((weak, visibility("default"))) char *tzname[2] = {(char *)"UTC", (char *)"UTC"};
__attribute__((weak, visibility("default"))) char *__tzname[2] = {(char *)"UTC", (char *)"UTC"};

__attribute__((constructor(101))) static void __bionic_compat_init_timezone(void) {
    tzset();
}

typedef enum {
    __SPAWN_ACT_CLOSE,
    __SPAWN_ACT_DUP2,
    __SPAWN_ACT_OPEN
} __spawn_act_type;

struct __spawn_action {
    __spawn_act_type type;
    int fd;
    int newfd;
    char *path;
    int oflag;
    mode_t mode;
    struct __spawn_action *next;
};

struct __posix_spawn_file_actions {
    struct __spawn_action *head;
    struct __spawn_action *tail;
};

struct __posix_spawnattr {
    short flags;
    pid_t pgroup;
    sigset_t sigmask;
    sigset_t sigdefault;
};

__attribute__((weak, visibility("default"))) int posix_spawn_file_actions_init(posix_spawn_file_actions_t *fa) {
    if (!fa) return EINVAL;
    *fa = (posix_spawn_file_actions_t)calloc(1, sizeof(struct __posix_spawn_file_actions));
    if (!*fa) return ENOMEM;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawn_file_actions_destroy(posix_spawn_file_actions_t *fa) {
    if (!fa || !*fa) return EINVAL;
    struct __spawn_action *act = (*fa)->head;
    while (act) {
        struct __spawn_action *next = act->next;
        if (act->path) free(act->path);
        free(act);
        act = next;
    }
    free(*fa);
    *fa = NULL;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawn_file_actions_addclose(posix_spawn_file_actions_t *fa, int fd) {
    if (!fa || !*fa || fd < 0) return EINVAL;
    struct __spawn_action *act = (struct __spawn_action *)calloc(1, sizeof(struct __spawn_action));
    if (!act) return ENOMEM;
    act->type = __SPAWN_ACT_CLOSE;
    act->fd = fd;
    if (!(*fa)->head) (*fa)->head = act;
    else (*fa)->tail->next = act;
    (*fa)->tail = act;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawn_file_actions_adddup2(posix_spawn_file_actions_t *fa, int fd, int newfd) {
    if (!fa || !*fa || fd < 0 || newfd < 0) return EINVAL;
    struct __spawn_action *act = (struct __spawn_action *)calloc(1, sizeof(struct __spawn_action));
    if (!act) return ENOMEM;
    act->type = __SPAWN_ACT_DUP2;
    act->fd = fd;
    act->newfd = newfd;
    if (!(*fa)->head) (*fa)->head = act;
    else (*fa)->tail->next = act;
    (*fa)->tail = act;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawn_file_actions_addopen(posix_spawn_file_actions_t *fa, int fd, const char *path, int oflag, mode_t mode) {
    if (!fa || !*fa || fd < 0 || !path) return EINVAL;
    struct __spawn_action *act = (struct __spawn_action *)calloc(1, sizeof(struct __spawn_action));
    if (!act) return ENOMEM;
    act->type = __SPAWN_ACT_OPEN;
    act->fd = fd;
    act->path = strdup(path);
    act->oflag = oflag;
    act->mode = mode;
    if (!(*fa)->head) (*fa)->head = act;
    else (*fa)->tail->next = act;
    (*fa)->tail = act;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_init(posix_spawnattr_t *attr) {
    if (!attr) return EINVAL;
    *attr = (posix_spawnattr_t)calloc(1, sizeof(struct __posix_spawnattr));
    if (!*attr) return ENOMEM;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_destroy(posix_spawnattr_t *attr) {
    if (!attr || !*attr) return EINVAL;
    free(*attr);
    *attr = NULL;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_setflags(posix_spawnattr_t *attr, short flags) {
    if (!attr || !*attr) return EINVAL;
    (*attr)->flags = flags;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_getflags(const posix_spawnattr_t *attr, short *flags) {
    if (!attr || !*attr || !flags) return EINVAL;
    *flags = (*attr)->flags;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_setpgroup(posix_spawnattr_t *attr, pid_t pgroup) {
    if (!attr || !*attr) return EINVAL;
    (*attr)->pgroup = pgroup;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_getpgroup(const posix_spawnattr_t *attr, pid_t *pgroup) {
    if (!attr || !*attr || !pgroup) return EINVAL;
    *pgroup = (*attr)->pgroup;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_setsigmask(posix_spawnattr_t *attr, const sigset_t *sigmask) {
    if (!attr || !*attr || !sigmask) return EINVAL;
    (*attr)->sigmask = *sigmask;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_getsigmask(const posix_spawnattr_t *attr, sigset_t *sigmask) {
    if (!attr || !*attr || !sigmask) return EINVAL;
    *sigmask = (*attr)->sigmask;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_setsigdefault(posix_spawnattr_t *attr, const sigset_t *sigdefault) {
    if (!attr || !*attr || !sigdefault) return EINVAL;
    (*attr)->sigdefault = *sigdefault;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnattr_getsigdefault(const posix_spawnattr_t *attr, sigset_t *sigdefault) {
    if (!attr || !*attr || !sigdefault) return EINVAL;
    *sigdefault = (*attr)->sigdefault;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawn(
    pid_t *pid,
    const char *path,
    const posix_spawn_file_actions_t *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[],
    char *const envp[]
) {
    pid_t child = fork();
    if (child < 0) return errno;
    if (child == 0) {
        if (attrp && *attrp) {
            const struct __posix_spawnattr *sa = *attrp;
            if (sa->flags & POSIX_SPAWN_SETPGROUP) {
                setpgid(0, sa->pgroup);
            }
            if (sa->flags & POSIX_SPAWN_SETSIGMASK) {
                sigprocmask(SIG_SETMASK, &sa->sigmask, NULL);
            }
            if (sa->flags & POSIX_SPAWN_SETSIGDEF) {
                struct sigaction sact;
                memset(&sact, 0, sizeof(sact));
                sact.sa_handler = SIG_DFL;
                for (int i = 1; i < 32; ++i) {
                    if (sigismember(&sa->sigdefault, i)) {
                        sigaction(i, &sact, NULL);
                    }
                }
            }
            if (sa->flags & POSIX_SPAWN_RESETIDS) {
                seteuid(getuid());
                setegid(getgid());
            }
        }
        if (file_actions && *file_actions && (*file_actions)->head) {
            struct __spawn_action *act = (*file_actions)->head;
            while (act) {
                if (act->type == __SPAWN_ACT_CLOSE) {
                    close(act->fd);
                } else if (act->type == __SPAWN_ACT_DUP2) {
                    dup2(act->fd, act->newfd);
                } else if (act->type == __SPAWN_ACT_OPEN) {
                    int fd = open(act->path, act->oflag, act->mode);
                    if (fd >= 0 && fd != act->fd) {
                        dup2(fd, act->fd);
                        close(fd);
                    }
                }
                act = act->next;
            }
        }
        char *const *cur_env = envp ? envp : (char *const *)environ;
        execve(path, argv, cur_env);
        _exit(127);
    }
    if (pid) *pid = child;
    return 0;
}

__attribute__((weak, visibility("default"))) int posix_spawnp(
    pid_t *pid,
    const char *file,
    const posix_spawn_file_actions_t *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[],
    char *const envp[]
) {
    pid_t child = fork();
    if (child < 0) return errno;
    if (child == 0) {
        if (attrp && *attrp) {
            const struct __posix_spawnattr *sa = *attrp;
            if (sa->flags & POSIX_SPAWN_SETPGROUP) {
                setpgid(0, sa->pgroup);
            }
            if (sa->flags & POSIX_SPAWN_SETSIGMASK) {
                sigprocmask(SIG_SETMASK, &sa->sigmask, NULL);
            }
            if (sa->flags & POSIX_SPAWN_SETSIGDEF) {
                struct sigaction sact;
                memset(&sact, 0, sizeof(sact));
                sact.sa_handler = SIG_DFL;
                for (int i = 1; i < 32; ++i) {
                    if (sigismember(&sa->sigdefault, i)) {
                        sigaction(i, &sact, NULL);
                    }
                }
            }
            if (sa->flags & POSIX_SPAWN_RESETIDS) {
                seteuid(getuid());
                setegid(getgid());
            }
        }
        if (file_actions && *file_actions && (*file_actions)->head) {
            struct __spawn_action *act = (*file_actions)->head;
            while (act) {
                if (act->type == __SPAWN_ACT_CLOSE) {
                    close(act->fd);
                } else if (act->type == __SPAWN_ACT_DUP2) {
                    dup2(act->fd, act->newfd);
                } else if (act->type == __SPAWN_ACT_OPEN) {
                    int fd = open(act->path, act->oflag, act->mode);
                    if (fd >= 0 && fd != act->fd) {
                        dup2(fd, act->fd);
                        close(fd);
                    }
                }
                act = act->next;
            }
        }
        char *const *cur_env = envp ? envp : (char *const *)environ;
        execvpe(file, argv, cur_env);
        _exit(127);
    }
    if (pid) *pid = child;
    return 0;
}

__attribute__((weak, visibility("default"))) char *gettext(const char *msgid) { return (char *)msgid; }
__attribute__((weak, visibility("default"))) char *dgettext(const char *domainname, const char *msgid) { (void)domainname; return (char *)msgid; }
__attribute__((weak, visibility("default"))) char *dcgettext(const char *domainname, const char *msgid, int category) { (void)domainname; (void)category; return (char *)msgid; }
__attribute__((weak, visibility("default"))) char *ngettext(const char *msgid1, const char *msgid2, unsigned long int n) { return (char *)(n == 1 ? msgid1 : msgid2); }
__attribute__((weak, visibility("default"))) char *dngettext(const char *domainname, const char *msgid1, const char *msgid2, unsigned long int n) { (void)domainname; return (char *)(n == 1 ? msgid1 : msgid2); }
__attribute__((weak, visibility("default"))) char *dcngettext(const char *domainname, const char *msgid1, const char *msgid2, unsigned long int n, int category) { (void)domainname; (void)category; return (char *)(n == 1 ? msgid1 : msgid2); }
__attribute__((weak, visibility("default"))) char *textdomain(const char *domainname) { (void)domainname; return (char *)"messages"; }
__attribute__((weak, visibility("default"))) char *bindtextdomain(const char *domainname, const char *dirname) { (void)domainname; (void)dirname; return (char *)""; }
__attribute__((weak, visibility("default"))) char *bind_textdomain_codeset(const char *domainname, const char *codeset) { (void)domainname; (void)codeset; return (char *)"UTF-8"; }

__attribute__((weak, visibility("default"))) void error(int status, int errnum, const char *fmt, ...) { va_list ap; va_start(ap, fmt); vfprintf(stderr, fmt, ap); va_end(ap); if (errnum) fprintf(stderr, ": %s\n", strerror(errnum)); else fputc('\n', stderr); if (status) exit(status); }
__attribute__((weak, visibility("default"))) void error_at_line(int status, int errnum, const char *fname, unsigned int lineno, const char *fmt, ...) { fprintf(stderr, "%s:%u: ", fname, lineno); va_list ap; va_start(ap, fmt); vfprintf(stderr, fmt, ap); va_end(ap); if (errnum) fprintf(stderr, ": %s\n", strerror(errnum)); else fputc('\n', stderr); if (status) exit(status); }
__attribute__((weak, visibility("default"))) int fpurge(FILE *stream) { (void)stream; return 0; }
__attribute__((weak, visibility("default"))) void __fpurge(FILE *stream) { (void)stream; }
__attribute__((weak, visibility("default"))) int getdomainname(char *name, size_t len) { if (len > 0) name[0] = '\0'; return 0; }
__attribute__((weak, visibility("default"))) int setdomainname(const char *name, size_t len) { (void)name; (void)len; return 0; }

__attribute__((weak, visibility("default"))) void *__memcpy_chk(void *dest, const void *src, size_t len, size_t destlen) { (void)destlen; return memcpy(dest, src, len); }
__attribute__((weak, visibility("default"))) void *__memmove_chk(void *dest, const void *src, size_t len, size_t destlen) { (void)destlen; return memmove(dest, src, len); }
__attribute__((weak, visibility("default"))) void *__memset_chk(void *dest, int c, size_t len, size_t destlen) { (void)destlen; return memset(dest, c, len); }
__attribute__((weak, visibility("default"))) char *__strcpy_chk(char *dest, const char *src, size_t destlen) { (void)destlen; return strcpy(dest, src); }
__attribute__((weak, visibility("default"))) char *__strncpy_chk(char *dest, const char *src, size_t len, size_t destlen) { (void)destlen; return strncpy(dest, src, len); }
__attribute__((weak, visibility("default"))) char *__strcat_chk(char *dest, const char *src, size_t destlen) { (void)destlen; return strcat(dest, src); }
__attribute__((weak, visibility("default"))) char *__strncat_chk(char *dest, const char *src, size_t len, size_t destlen) { (void)destlen; return strncat(dest, src, len); }
__attribute__((weak, visibility("default"))) void *__mempcpy_chk(void *dest, const void *src, size_t len, size_t buflen) { (void)buflen; return (void *)((char *)memcpy(dest, src, len) + len); }
__attribute__((weak, visibility("default"))) char *__stpcpy_chk(char *dest, const char *src, size_t buflen) { (void)buflen; return stpcpy(dest, src); }
__attribute__((weak, visibility("default"))) char *__stpncpy_chk(char *dest, const char *src, size_t n, size_t buflen) { (void)buflen; return stpncpy(dest, src, n); }

__attribute__((weak, visibility("default"))) wchar_t *__wmemset_chk(wchar_t *s, wchar_t c, size_t n, size_t buflen) { (void)buflen; return wmemset(s, c, n); }
__attribute__((weak, visibility("default"))) wchar_t *__wmemcpy_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen) { (void)buflen; return wmemcpy(dest, src, n); }
__attribute__((weak, visibility("default"))) wchar_t *__wmemmove_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen) { (void)buflen; return wmemmove(dest, src, n); }
__attribute__((weak, visibility("default"))) wchar_t *__wmempcpy_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen) { (void)buflen; return (wchar_t *)((char *)wmemcpy(dest, src, n) + n * sizeof(wchar_t)); }
__attribute__((weak, visibility("default"))) wchar_t *__wcscpy_chk(wchar_t *dest, const wchar_t *src, size_t buflen) { (void)buflen; return wcscpy(dest, src); }
__attribute__((weak, visibility("default"))) wchar_t *__wcsncpy_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen) { (void)buflen; return wcsncpy(dest, src, n); }
__attribute__((weak, visibility("default"))) wchar_t *__wcscat_chk(wchar_t *dest, const wchar_t *src, size_t buflen) { (void)buflen; return wcscat(dest, src); }
__attribute__((weak, visibility("default"))) wchar_t *__wcsncat_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen) { (void)buflen; return wcsncat(dest, src, n); }

__attribute__((weak, visibility("default"))) size_t __mbsrtowcs_chk(wchar_t *dst, const char **src, size_t len, mbstate_t *ps, size_t buflen) { (void)buflen; return mbsrtowcs(dst, src, len, ps); }
__attribute__((weak, visibility("default"))) size_t __mbsnrtowcs_chk(wchar_t *dst, const char **src, size_t nmc, size_t len, mbstate_t *ps, size_t buflen) { (void)buflen; return mbsnrtowcs(dst, src, nmc, len, ps); }
__attribute__((weak, visibility("default"))) size_t __wcsrtombs_chk(char *dst, const wchar_t **src, size_t len, mbstate_t *ps, size_t buflen) { (void)buflen; return wcsrtombs(dst, src, len, ps); }
__attribute__((weak, visibility("default"))) size_t __wcsnrtombs_chk(char *dst, const wchar_t **src, size_t nwc, size_t len, mbstate_t *ps, size_t buflen) { (void)buflen; return wcsnrtombs(dst, src, nwc, len, ps); }
__attribute__((weak, visibility("default"))) size_t __mbstowcs_chk(wchar_t *dst, const char *src, size_t len, size_t buflen) { (void)buflen; return mbstowcs(dst, src, len); }
__attribute__((weak, visibility("default"))) size_t __wcstombs_chk(char *dst, const wchar_t *src, size_t len, size_t buflen) { (void)buflen; return wcstombs(dst, src, len); }
__attribute__((weak, visibility("default"))) size_t __wcrtomb_chk(char *s, wchar_t wc, mbstate_t *ps, size_t buflen) { (void)buflen; return wcrtomb(s, wc, ps); }
__attribute__((weak, visibility("default"))) int __wctomb_chk(char *s, wchar_t wchar, size_t buflen) { (void)buflen; return wctomb(s, wchar); }

__attribute__((weak, visibility("default"))) int __swprintf_chk(wchar_t *s, size_t n, int flag, size_t slen, const wchar_t *format, ...) { (void)flag; (void)slen; va_list ap; va_start(ap, format); int r = vswprintf(s, n, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vswprintf_chk(wchar_t *s, size_t n, int flag, size_t slen, const wchar_t *format, va_list ap) { (void)flag; (void)slen; return vswprintf(s, n, format, ap); }
__attribute__((weak, visibility("default"))) int __fwprintf_chk(FILE *stream, int flag, const wchar_t *format, ...) { (void)flag; va_list ap; va_start(ap, format); int r = vfwprintf(stream, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vfwprintf_chk(FILE *stream, int flag, const wchar_t *format, va_list ap) { (void)flag; return vfwprintf(stream, format, ap); }
__attribute__((weak, visibility("default"))) int __wprintf_chk(int flag, const wchar_t *format, ...) { (void)flag; va_list ap; va_start(ap, format); int r = vwprintf(format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vwprintf_chk(int flag, const wchar_t *format, va_list ap) { (void)flag; return vwprintf(format, ap); }
__attribute__((weak, visibility("default"))) wchar_t *__fgetws_chk(wchar_t *s, int n, FILE *stream, size_t buflen) { (void)buflen; return fgetws(s, n, stream); }
__attribute__((weak, visibility("default"))) wchar_t *__fgetws_unlocked_chk(wchar_t *s, int n, FILE *stream, size_t buflen) { (void)buflen; return fgetws(s, n, stream); }

__attribute__((weak, visibility("default"))) int __snprintf_chk(char *s, size_t maxlen, int flag, size_t slen, const char *format, ...) { (void)flag; (void)slen; va_list ap; va_start(ap, format); int r = vsnprintf(s, maxlen, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vsnprintf_chk(char *s, size_t maxlen, int flag, size_t slen, const char *format, va_list ap) { (void)flag; (void)slen; return vsnprintf(s, maxlen, format, ap); }
__attribute__((weak, visibility("default"))) int __sprintf_chk(char *s, int flag, size_t slen, const char *format, ...) { (void)flag; (void)slen; va_list ap; va_start(ap, format); int r = vsprintf(s, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vsprintf_chk(char *s, int flag, size_t slen, const char *format, va_list ap) { (void)flag; (void)slen; return vsprintf(s, format, ap); }
__attribute__((weak, visibility("default"))) int __printf_chk(int flag, const char *format, ...) { (void)flag; va_list ap; va_start(ap, format); int r = vprintf(format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vprintf_chk(int flag, const char *format, va_list ap) { (void)flag; return vprintf(format, ap); }
__attribute__((weak, visibility("default"))) int __fprintf_chk(FILE *stream, int flag, const char *format, ...) { (void)flag; va_list ap; va_start(ap, format); int r = vfprintf(stream, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vfprintf_chk(FILE *stream, int flag, const char *format, va_list ap) { (void)flag; return vfprintf(stream, format, ap); }
__attribute__((weak, visibility("default"))) int __dprintf_chk(int fd, int flag, const char *format, ...) { (void)flag; va_list ap; va_start(ap, format); int r = vdprintf(fd, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vdprintf_chk(int fd, int flag, const char *format, va_list ap) { (void)flag; return vdprintf(fd, format, ap); }
__attribute__((weak, visibility("default"))) int __asprintf_chk(char **result_ptr, int flag, const char *format, ...) { (void)flag; va_list ap; va_start(ap, format); int r = vasprintf(result_ptr, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vasprintf_chk(char **result_ptr, int flag, const char *format, va_list ap) { (void)flag; return vasprintf(result_ptr, format, ap); }

__attribute__((weak, visibility("default"))) char *__fgets_chk(char *s, int n, FILE *stream, size_t buflen) { (void)buflen; return fgets(s, n, stream); }
__attribute__((weak, visibility("default"))) char *__fgets_unlocked_chk(char *s, int n, FILE *stream, size_t buflen) { (void)buflen; return fgets(s, n, stream); }
__attribute__((weak, visibility("default"))) size_t __fread_chk(void *ptr, size_t size, size_t n, FILE *stream, size_t buflen) { (void)buflen; return fread(ptr, size, n, stream); }
__attribute__((weak, visibility("default"))) size_t __fread_unlocked_chk(void *ptr, size_t size, size_t n, FILE *stream, size_t buflen) { (void)buflen; return fread(ptr, size, n, stream); }
__attribute__((weak, visibility("default"))) ssize_t __read_chk(int fd, void *buf, size_t nbytes, size_t buflen) { (void)buflen; return read(fd, buf, nbytes); }
__attribute__((weak, visibility("default"))) ssize_t __pread_chk(int fd, void *buf, size_t nbytes, off_t offset, size_t buflen) { (void)buflen; return pread(fd, buf, nbytes, offset); }
__attribute__((weak, visibility("default"))) ssize_t __pread64_chk(int fd, void *buf, size_t nbytes, off64_t offset, size_t buflen) { (void)buflen; return pread64(fd, buf, nbytes, offset); }
__attribute__((weak, visibility("default"))) ssize_t __readlink_chk(const char *path, char *buf, size_t len, size_t buflen) { (void)buflen; return readlink(path, buf, len); }
__attribute__((weak, visibility("default"))) ssize_t __readlinkat_chk(int dirfd, const char *path, char *buf, size_t len, size_t buflen) { (void)buflen; return readlinkat(dirfd, path, buf, len); }
__attribute__((weak, visibility("default"))) char *__getcwd_chk(char *buf, size_t len, size_t buflen) { (void)buflen; return getcwd(buf, len); }
__attribute__((weak, visibility("default"))) char *__realpath_chk(const char *path, char *resolved_path, size_t buflen) { (void)buflen; return realpath(path, resolved_path); }
__attribute__((weak, visibility("default"))) ssize_t __recv_chk(int fd, void *buf, size_t len, size_t buflen, int flags) { (void)buflen; return recv(fd, buf, len, flags); }
__attribute__((weak, visibility("default"))) ssize_t __recvfrom_chk(int fd, void *buf, size_t len, size_t buflen, int flags, struct sockaddr *src_addr, socklen_t *addrlen) { (void)buflen; return recvfrom(fd, buf, len, flags, src_addr, addrlen); }
__attribute__((weak, visibility("default"))) int __poll_chk(struct pollfd *fds, nfds_t nfds, int timeout, size_t fds_size) { (void)fds_size; return poll(fds, nfds, timeout); }
__attribute__((weak, visibility("default"))) int __ppoll_chk(struct pollfd *fds, nfds_t nfds, const struct timespec *tmo_p, const sigset_t *sigmask, size_t fds_size) { (void)fds_size; return ppoll(fds, nfds, tmo_p, sigmask); }
__attribute__((weak, visibility("default"))) long int __fdelt_chk(long int d) { return d / (8 * (long int)sizeof(long int)); }

__attribute__((weak, visibility("default"))) int *__errno(void) { return &errno; }
__attribute__((weak, visibility("default"))) int *__errno_location(void) { return __errno(); }
__attribute__((weak, visibility("default"))) int *__h_errno_location(void) { return __errno(); }
__attribute__((weak, visibility("default"))) int *__get_h_errno(void) { return __errno(); }
__attribute__((weak, visibility("default"))) int *__h_errno(void) { return __errno(); }

__attribute__((weak, visibility("default"))) int __libc_start_main(
    int (*main)(int, char **, char **),
    int argc,
    char **argv,
    int (*init)(int, char **, char **),
    void (*fini)(void),
    void (*rtld_fini)(void),
    void *stack_end
) {
    (void)stack_end;
    char **envp = argv + argc + 1;
    environ = envp;
    if (rtld_fini) atexit(rtld_fini);
    if (fini) atexit(fini);
    if (init) init(argc, argv, envp);
    exit(main(argc, argv, envp));
}

__attribute__((weak, visibility("default"))) int __cxa_at_quick_exit(void (*func)(void), void *dso_handle) { (void)dso_handle; return atexit(func); }
__attribute__((weak, visibility("default"))) int at_quick_exit(void (*func)(void)) { return atexit(func); }
__attribute__((weak, visibility("default"))) void quick_exit(int status) { exit(status); }
__attribute__((weak, visibility("default"))) void __wrap_quick_exit(int status) { exit(status); }
__attribute__((weak, visibility("default"))) int _dl_find_object(void *address, void *result) {
    (void)address; (void)result;
    errno = ENOENT;
    return -1;
}

__attribute__((weak, visibility("default"))) int dl_find_object(void *address, void *result) {
    (void)address; (void)result;
    errno = ENOENT;
    return -1;
}

__attribute__((weak, visibility("default"))) int dladdr1(const void *addr, Dl_info *info, void **extra_info, int flags) {
    if (extra_info) *extra_info = NULL;
    if (flags != 0) return 0;
    return dladdr(addr, info);
}
__attribute__((weak, visibility("default"))) void *__libc_dlopen_mode(const char *name, int mode) { return dlopen(name, mode); }
__attribute__((weak, visibility("default"))) void *__libc_dlsym(void *handle, const char *name) { return dlsym(handle, name); }
__attribute__((weak, visibility("default"))) int __libc_dlclose(void *handle) { return dlclose(handle); }
__attribute__((weak, visibility("default"))) int __register_atfork(void (*prepare)(void), void (*parent)(void), void (*child)(void), void *dso_handle) { (void)dso_handle; return pthread_atfork(prepare, parent, child); }
__attribute__((weak, visibility("default"))) int __libc_current_sigrtmin(void) { return SIGRTMIN; }
__attribute__((weak, visibility("default"))) int __libc_current_sigrtmax(void) { return SIGRTMAX; }

__attribute__((weak, visibility("default"))) int timespec_get(struct timespec *ts, int base) { if (base != 1) return 0; return clock_gettime(CLOCK_REALTIME, ts) == 0 ? base : 0; }
__attribute__((weak, visibility("default"))) int timespec_getres(struct timespec *ts, int base) { if (base != 1) return 0; return clock_getres(CLOCK_REALTIME, ts) == 0 ? base : 0; }

__attribute__((weak, visibility("default"))) locale_t __newlocale(int category_mask, const char *locale, locale_t base) {
    typedef locale_t (*fn_t)(int, const char*, locale_t);
    fn_t fn = (fn_t)dlsym(RTLD_DEFAULT, "newlocale");
    if (fn) return fn(category_mask, locale, base);
    return LC_GLOBAL_LOCALE;
}

__attribute__((weak, visibility("default"))) void __freelocale(locale_t loc) {
    typedef void (*fn_t)(locale_t);
    fn_t fn = (fn_t)dlsym(RTLD_DEFAULT, "freelocale");
    if (fn && loc != LC_GLOBAL_LOCALE) fn(loc);
}

__attribute__((weak, visibility("default"))) locale_t __uselocale(locale_t loc) {
    typedef locale_t (*fn_t)(locale_t);
    fn_t fn = (fn_t)dlsym(RTLD_DEFAULT, "uselocale");
    if (fn) return fn(loc);
    return LC_GLOBAL_LOCALE;
}

__attribute__((weak, visibility("default"))) locale_t __duplocale(locale_t loc) {
    typedef locale_t (*fn_t)(locale_t);
    fn_t fn = (fn_t)dlsym(RTLD_DEFAULT, "duplocale");
    if (fn && loc != LC_GLOBAL_LOCALE) return fn(loc);
    return loc;
}

__attribute__((weak, visibility("default"))) char *__nl_langinfo_l(nl_item item, locale_t loc) {
    typedef char* (*fn_t)(nl_item, locale_t);
    fn_t fn = (fn_t)dlsym(RTLD_DEFAULT, "nl_langinfo_l");
    if (fn) return fn(item, loc);
    return nl_langinfo(item);
}
__attribute__((weak, visibility("default"))) int __toupper_l(int c, locale_t loc) { (void)loc; return toupper(c); }
__attribute__((weak, visibility("default"))) int __tolower_l(int c, locale_t loc) { (void)loc; return tolower(c); }
__attribute__((weak, visibility("default"))) wint_t __towupper_l(wint_t wc, locale_t loc) { (void)loc; return towupper(wc); }
__attribute__((weak, visibility("default"))) wint_t __towlower_l(wint_t wc, locale_t loc) { (void)loc; return towlower(wc); }
__attribute__((weak, visibility("default"))) double __strtod_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtod(nptr, endptr); }
__attribute__((weak, visibility("default"))) float __strtof_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtof(nptr, endptr); }
__attribute__((weak, visibility("default"))) long double __strtold_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtold(nptr, endptr); }
__attribute__((weak, visibility("default"))) long __strtol_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtol(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) unsigned long __strtoul_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoul(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) long long __strtoll_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoll(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) unsigned long long __strtoull_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoull(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) size_t __strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc) { (void)loc; return strftime(s, max, fmt, tm); }
__attribute__((weak, visibility("default"))) size_t __wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc) { (void)loc; return wcsftime(s, max, fmt, tm); }
__attribute__((weak, visibility("default"))) int __strcoll_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcoll(s1, s2); }
__attribute__((weak, visibility("default"))) size_t __strxfrm_l(char *dest, const char *src, size_t n, locale_t loc) { (void)loc; return strxfrm(dest, src, n); }
__attribute__((weak, visibility("default"))) int __wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscoll(s1, s2); }
__attribute__((weak, visibility("default"))) size_t __wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc) { (void)loc; return wcsxfrm(dest, src, n); }
__attribute__((weak, visibility("default"))) int __strcasecmp_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcasecmp(s1, s2); }
__attribute__((weak, visibility("default"))) int __strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc) { (void)loc; return strncasecmp(s1, s2, n); }
__attribute__((weak, visibility("default"))) int __wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscasecmp(s1, s2); }
__attribute__((weak, visibility("default"))) int __wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc) { (void)loc; return wcsncasecmp(s1, s2, n); }
__attribute__((weak, visibility("default"))) int __iswalpha_l(wint_t wc, locale_t loc) { (void)loc; return iswalpha(wc); }
__attribute__((weak, visibility("default"))) int __iswdigit_l(wint_t wc, locale_t loc) { (void)loc; return iswdigit(wc); }
__attribute__((weak, visibility("default"))) int __iswspace_l(wint_t wc, locale_t loc) { (void)loc; return iswspace(wc); }
__attribute__((weak, visibility("default"))) int __iswctype_l(wint_t wc, wctype_t desc, locale_t loc) { (void)loc; return iswctype(wc, desc); }
__attribute__((weak, visibility("default"))) wctype_t __wctype_l(const char *name, locale_t loc) { (void)loc; return wctype(name); }

__attribute__((weak, visibility("default"))) int strcoll_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcoll(s1, s2); }
__attribute__((weak, visibility("default"))) size_t strxfrm_l(char *dest, const char *src, size_t n, locale_t loc) { (void)loc; return strxfrm(dest, src, n); }
__attribute__((weak, visibility("default"))) int wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscoll(s1, s2); }
__attribute__((weak, visibility("default"))) size_t wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc) { (void)loc; return wcsxfrm(dest, src, n); }
__attribute__((weak, visibility("default"))) int strcasecmp_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcasecmp(s1, s2); }
__attribute__((weak, visibility("default"))) int strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc) { (void)loc; return strncasecmp(s1, s2, n); }
__attribute__((weak, visibility("default"))) int wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscasecmp(s1, s2); }
__attribute__((weak, visibility("default"))) int wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc) { (void)loc; return wcsncasecmp(s1, s2, n); }
__attribute__((weak, visibility("default"))) wint_t towupper_l(wint_t wc, locale_t loc) { (void)loc; return towupper(wc); }
__attribute__((weak, visibility("default"))) wint_t towlower_l(wint_t wc, locale_t loc) { (void)loc; return towlower(wc); }
__attribute__((weak, visibility("default"))) int iswalpha_l(wint_t wc, locale_t loc) { (void)loc; return iswalpha(wc); }
__attribute__((weak, visibility("default"))) int iswdigit_l(wint_t wc, locale_t loc) { (void)loc; return iswdigit(wc); }
__attribute__((weak, visibility("default"))) int iswspace_l(wint_t wc, locale_t loc) { (void)loc; return iswspace(wc); }
__attribute__((weak, visibility("default"))) int iswctype_l(wint_t wc, wctype_t desc, locale_t loc) { (void)loc; return iswctype(wc, desc); }
__attribute__((weak, visibility("default"))) wctype_t wctype_l(const char *name, locale_t loc) { (void)loc; return wctype(name); }
__attribute__((weak, visibility("default"))) long strtol_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtol(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) unsigned long strtoul_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoul(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) long long strtoll_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoll(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) unsigned long long strtoull_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoull(nptr, endptr, base); }
__attribute__((weak, visibility("default"))) size_t strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc) { (void)loc; return strftime(s, max, fmt, tm); }
__attribute__((weak, visibility("default"))) size_t wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc) { (void)loc; return wcsftime(s, max, fmt, tm); }

__attribute__((weak, visibility("default"))) int backtrace(void **b, int s) { (void)b; (void)s; return 0; }
__attribute__((weak, visibility("default"))) char **backtrace_symbols(void *const *b, int s) { (void)b; (void)s; return NULL; }
__attribute__((weak, visibility("default"))) void backtrace_symbols_fd(void *const *b, int s, int f) { (void)b; (void)s; (void)f; }
__attribute__((weak, visibility("default"))) int pthread_setcancelstate(int state, int *oldstate) { if (oldstate) *oldstate = state; return 0; }
__attribute__((weak, visibility("default"))) int pthread_setcanceltype(int type, int *oldtype) { if (oldtype) *oldtype = type; return 0; }
__attribute__((weak, visibility("default"))) int pthread_cancel(pthread_t thread) { (void)thread; return 0; }
__attribute__((weak, visibility("default"))) void pthread_testcancel(void) {}
__attribute__((weak, visibility("default"))) int pthread_getattr_np(pthread_t thread, pthread_attr_t *attr) {
    typedef int (*fn_t)(pthread_t, pthread_attr_t*);
    static fn_t real_fn = (fn_t)-1;
    if (real_fn == (fn_t)-1) {
        void *sym = dlsym(RTLD_NEXT, "pthread_getattr_np");
        if (sym == (void*)pthread_getattr_np) sym = NULL;
        real_fn = (fn_t)sym;
    }
    if (real_fn && real_fn(thread, attr) == 0) {
        void *stack_addr = NULL;
        size_t stack_size = 0;
        if (pthread_attr_getstack(attr, &stack_addr, &stack_size) == 0 && stack_addr != NULL && stack_size > 0) {
            return 0;
        }
    }
    if (attr) {
        pthread_attr_init(attr);
        pthread_attr_setstack(attr, (void*)0x7f00000000UL, 8 * 1024 * 1024);
        return 0;
    }
    return -1;
}

__attribute__((weak, visibility("default"))) int pthread_yield(void) { return sched_yield(); }
__attribute__((weak, visibility("default"))) int pthread_getname_np(pthread_t thread, char *name, size_t len) {
    if (!name || len == 0) return ERANGE;
    typedef int (*fn_t)(pthread_t, char*, size_t);
    static fn_t real_fn = (fn_t)-1;
    if (real_fn == (fn_t)-1) {
        void *sym = dlsym(RTLD_NEXT, "pthread_getname_np");
        if (sym == (void*)pthread_getname_np) sym = NULL;
        real_fn = (fn_t)sym;
    }
    if (real_fn) return real_fn(thread, name, len);
#ifdef PR_GET_NAME
    if (thread == pthread_self()) {
        if (prctl(PR_GET_NAME, (unsigned long)name, 0, 0, 0) == 0) {
            name[len - 1] = '\0';
            return 0;
        }
    }
#endif
    snprintf(name, len, "thread_%lu", (unsigned long)thread);
    return 0;
}

__attribute__((weak, visibility("default"))) int memfd_create(const char *name, unsigned int flags) {
#ifdef __NR_memfd_create
    return (int)syscall(__NR_memfd_create, name, flags);
#else
    (void)name; (void)flags;
    errno = ENOSYS;
    return -1;
#endif
}

typedef void (*prop_read_callback_fn)(void* cookie, const char* name, const char* value, uint32_t serial);
typedef void (*real_sys_prop_read_cb_fn)(const void* pi, prop_read_callback_fn callback, void* cookie);
typedef int (*real_sys_prop_read_fn)(const void* pi, char* name, char* value);

__attribute__((weak, visibility("default"))) void __system_property_read_callback(const struct prop_info* pi, prop_read_callback_fn callback, void* cookie) {
    if (!pi || !callback) return;
    static real_sys_prop_read_cb_fn real_cb = (real_sys_prop_read_cb_fn)-1;
    if (real_cb == (real_sys_prop_read_cb_fn)-1) {
        void *sym = dlsym(RTLD_NEXT, "__system_property_read_callback");
        if (sym == (void*)__system_property_read_callback) sym = NULL;
        real_cb = (real_sys_prop_read_cb_fn)sym;
    }
    if (real_cb) {
        real_cb(pi, callback, cookie);
        return;
    }
    static real_sys_prop_read_fn real_read = (real_sys_prop_read_fn)-1;
    if (real_read == (real_sys_prop_read_fn)-1) {
        real_read = (real_sys_prop_read_fn)dlsym(RTLD_DEFAULT, "__system_property_read");
    }
    if (real_read) {
        char name[32] = {0};
        char value[92] = {0};
        if (real_read(pi, name, value) >= 0) {
            callback(cookie, name, value, 0);
        }
    }
}

struct AHardwareBuffer;
__attribute__((weak, visibility("default"))) void AHardwareBuffer_acquire(struct AHardwareBuffer* buffer) { (void)buffer; }
__attribute__((weak, visibility("default"))) void AHardwareBuffer_release(struct AHardwareBuffer* buffer) { (void)buffer; }

__attribute__((weak, visibility("default"))) int getentropy(void *buffer, size_t length) {
    if (length > 256) { errno = EIO; return -1; }
#ifdef __NR_getrandom
    int r = (int)syscall(__NR_getrandom, buffer, length, 0);
    if (r < 0) return -1;
    if ((size_t)r != length) { errno = EIO; return -1; }
    return 0;
#else
    int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    ssize_t r = read(fd, buffer, length);
    close(fd);
    if (r != (ssize_t)length) { errno = EIO; return -1; }
    return 0;
#endif
}

__attribute__((weak, visibility("default"))) int sigtimedwait(const sigset_t *set, siginfo_t *info, const struct timespec *timeout) { (void)set; (void)info; (void)timeout; errno = ENOSYS; return -1; }
__attribute__((weak, visibility("default"))) int sigwaitinfo(const sigset_t *set, siginfo_t *info) { (void)set; (void)info; errno = ENOSYS; return -1; }
__attribute__((weak, visibility("default"))) int signalfd(int fd, const sigset_t *mask, int flags) { (void)fd; (void)mask; (void)flags; errno = ENOSYS; return -1; }

__attribute__((weak, visibility("default"))) int __xstat(int ver, const char *path, struct stat *stat_buf) { (void)ver; return stat(path, stat_buf); }
__attribute__((weak, visibility("default"))) int __fxstat(int ver, int fd, struct stat *stat_buf) { (void)ver; return fstat(fd, stat_buf); }
__attribute__((weak, visibility("default"))) int __lxstat(int ver, const char *path, struct stat *stat_buf) { (void)ver; return lstat(path, stat_buf); }
__attribute__((weak, visibility("default"))) int __fxstatat(int ver, int dirfd, const char *path, struct stat *stat_buf, int flags) { (void)ver; return fstatat(dirfd, path, stat_buf, flags); }
__attribute__((weak, visibility("default"))) int __xstat64(int ver, const char *path, void *stat_buf) { (void)ver; return stat(path, (struct stat *)stat_buf); }
__attribute__((weak, visibility("default"))) int __fxstat64(int ver, int fd, void *stat_buf) { (void)ver; return fstat(fd, (struct stat *)stat_buf); }
__attribute__((weak, visibility("default"))) int __lxstat64(int ver, const char *path, void *stat_buf) { (void)ver; return lstat(path, (struct stat *)stat_buf); }
__attribute__((weak, visibility("default"))) int __fxstatat64(int ver, int dirfd, const char *path, void *stat_buf, int flags) { (void)ver; return fstatat(dirfd, path, (struct stat *)stat_buf, flags); }
__attribute__((weak, visibility("default"))) int __xmknod(int ver, const char *path, mode_t mode, dev_t *dev) { (void)ver; return mknod(path, mode, *dev); }
__attribute__((weak, visibility("default"))) int __xmknodat(int ver, int dirfd, const char *path, mode_t mode, dev_t *dev) { (void)ver; return mknodat(dirfd, path, mode, *dev); }

__attribute__((weak, visibility("default"))) int lchmod(const char *path, mode_t mode) { return fchmodat(AT_FDCWD, path, mode, AT_SYMLINK_NOFOLLOW); }
__attribute__((weak, visibility("default"))) int futimes(int fd, const struct timeval tv[2]) { struct timespec ts[2]; if (!tv) return futimens(fd, NULL); ts[0].tv_sec = tv[0].tv_sec; ts[0].tv_nsec = tv[0].tv_usec * 1000; ts[1].tv_sec = tv[1].tv_sec; ts[1].tv_nsec = tv[1].tv_usec * 1000; return futimens(fd, ts); }
__attribute__((weak, visibility("default"))) int lutimes(const char *path, const struct timeval tv[2]) { struct timespec ts[2]; if (!tv) return utimensat(AT_FDCWD, path, NULL, AT_SYMLINK_NOFOLLOW); ts[0].tv_sec = tv[0].tv_sec; ts[0].tv_nsec = tv[0].tv_usec * 1000; ts[1].tv_sec = tv[1].tv_sec; ts[1].tv_nsec = tv[1].tv_usec * 1000; return utimensat(AT_FDCWD, path, ts, AT_SYMLINK_NOFOLLOW); }
__attribute__((weak, visibility("default"))) int futimesat(int dirfd, const char *path, const struct timeval times[2]) { struct timespec ts[2]; if (!times) return utimensat(dirfd, path, NULL, 0); ts[0].tv_sec = times[0].tv_sec; ts[0].tv_nsec = times[0].tv_usec * 1000; ts[1].tv_sec = times[1].tv_sec; ts[1].tv_nsec = times[1].tv_usec * 1000; return utimensat(dirfd, path, ts, 0); }
__attribute__((weak, visibility("default"))) int posix_fadvise(int fd, off_t offset, off_t len, int advice) { (void)fd; (void)offset; (void)len; (void)advice; return 0; }
__attribute__((weak, visibility("default"))) int posix_fadvise64(int fd, off64_t offset, off64_t len, int advice) { (void)fd; (void)offset; (void)len; (void)advice; return 0; }
__attribute__((weak, visibility("default"))) int posix_fallocate(int fd, off_t offset, off_t len) { return posix_fallocate64(fd, offset, len); }
__attribute__((weak, visibility("default"))) int posix_fallocate64(int fd, off64_t offset, off64_t len) { return (int)syscall(__NR_fallocate, fd, 0, offset, len); }

__attribute__((weak, visibility("default"))) int getloadavg(double loadavg[], int nelem) { for (int i = 0; i < nelem; ++i) loadavg[i] = 0.0; return nelem; }
__attribute__((weak, visibility("default"))) int malloc_trim(size_t pad) { (void)pad; return 0; }
__attribute__((weak, visibility("default"))) void malloc_stats(void) {}
__attribute__((weak, visibility("default"))) int mallopt(int param, int value) { (void)param; (void)value; return 1; }
__attribute__((weak, visibility("default"))) char *secure_getenv(const char *name) { return getenv(name); }
__attribute__((weak, visibility("default"))) char *__secure_getenv(const char *name) { return getenv(name); }
__attribute__((weak, visibility("default"))) int clearenv(void) { if (environ) *environ = NULL; return 0; }

__attribute__((weak, visibility("default"))) char *strchrnul(const char *s, int c) { while (*s && *s != (char)c) s++; return (char *)s; }
__attribute__((weak, visibility("default"))) char *__strchrnul(const char *s, int c) { return strchrnul(s, c); }
__attribute__((weak, visibility("default"))) void *rawmemchr(const void *s, int c) { const unsigned char *p = (const unsigned char *)s; while (*p != (unsigned char)c) p++; return (void *)p; }
__attribute__((weak, visibility("default"))) void *__rawmemchr(const void *s, int c) { return rawmemchr(s, c); }
__attribute__((weak, visibility("default"))) void *mempcpy(void *dest, const void *src, size_t n) { return (void *)((char *)memcpy(dest, src, n) + n); }
__attribute__((weak, visibility("default"))) void *__mempcpy(void *dest, const void *src, size_t n) { return mempcpy(dest, src, n); }
__attribute__((weak, visibility("default"))) wchar_t *wmempcpy(wchar_t *dest, const wchar_t *src, size_t n) { return (wchar_t *)wmemcpy(dest, src, n) + n; }
__attribute__((weak, visibility("default"))) char *canonicalize_file_name(const char *path) { return realpath(path, NULL); }
__attribute__((weak, visibility("default"))) char *get_current_dir_name(void) { return getcwd(NULL, 0); }
__attribute__((weak, visibility("default"))) int sync_file_range(int fd, off64_t offset, off64_t nbytes, unsigned int flags) { (void)fd; (void)offset; (void)nbytes; (void)flags; return 0; }

__attribute__((weak, visibility("default"))) char *__strdup(const char *s) { return strdup(s); }
__attribute__((weak, visibility("default"))) char *__strndup(const char *s, size_t n) { return strndup(s, n); }
__attribute__((weak, visibility("default"))) char *__strtok_r(char *s, const char *d, char **p) { return strtok_r(s, d, p); }
__attribute__((weak, visibility("default"))) char *__stpcpy(char *d, const char *s) { return stpcpy(d, s); }
__attribute__((weak, visibility("default"))) char *__stpncpy(char *d, const char *s, size_t n) { return stpncpy(d, s, n); }
__attribute__((weak, visibility("default"))) int __asprintf(char **strp, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vasprintf(strp, fmt, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vasprintf(char **strp, const char *fmt, va_list ap) { return vasprintf(strp, fmt, ap); }
__attribute__((weak, visibility("default"))) int __dprintf(int fd, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vdprintf(fd, fmt, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vdprintf(int fd, const char *fmt, va_list ap) { return vdprintf(fd, fmt, ap); }
__attribute__((weak, visibility("default"))) int __snprintf(char *s, size_t n, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vsnprintf(s, n, fmt, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vsnprintf(char *s, size_t n, const char *fmt, va_list ap) { return vsnprintf(s, n, fmt, ap); }
__attribute__((weak, visibility("default"))) int __sprintf(char *s, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vsprintf(s, fmt, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __vsprintf(char *s, const char *fmt, va_list ap) { return vsprintf(s, fmt, ap); }

__attribute__((weak, visibility("default"))) time_t timelocal(struct tm *tm) { return mktime(tm); }
__attribute__((weak, visibility("default"))) int stime(const time_t *t) { (void)t; errno = EPERM; return -1; }
__attribute__((weak, visibility("default"))) int res_init(void) { return 0; }
__attribute__((weak, visibility("default"))) int __res_init(void) { return 0; }
__attribute__((weak, visibility("default"))) unsigned int gnu_dev_major(unsigned long long dev) { return (unsigned int)((dev >> 8) & 0xfff); }
__attribute__((weak, visibility("default"))) unsigned int gnu_dev_minor(unsigned long long dev) { return (unsigned int)((dev & 0xff) | ((dev >> 12) & 0xfff00)); }
__attribute__((weak, visibility("default"))) unsigned long long gnu_dev_makedev(unsigned int maj, unsigned int min) { return ((unsigned long long)(maj & 0xfff) << 8) | (min & 0xff) | ((unsigned long long)(min & 0xfff00) << 12); }

__attribute__((weak, visibility("default"))) cpu_set_t *__sched_cpualloc(size_t count) { return (cpu_set_t *)calloc(1, (count + 7) / 8); }
__attribute__((weak, visibility("default"))) void __sched_cpufree(cpu_set_t *set) { free(set); }
__attribute__((weak, visibility("default"))) int __sched_cpucount(size_t setsize, const cpu_set_t *set) { int c = 0; const unsigned char *p = (const unsigned char *)set; for (size_t i = 0; i < setsize; ++i) c += __builtin_popcount(p[i]); return c; }

__attribute__((weak, visibility("default"))) double __exp_finite(double x) { return exp(x); }
__attribute__((weak, visibility("default"))) double __exp2_finite(double x) { return exp2(x); }
__attribute__((weak, visibility("default"))) double __log_finite(double x) { return log(x); }
__attribute__((weak, visibility("default"))) double __log2_finite(double x) { return log2(x); }
__attribute__((weak, visibility("default"))) double __log10_finite(double x) { return log10(x); }
__attribute__((weak, visibility("default"))) double __pow_finite(double x, double y) { return pow(x, y); }
__attribute__((weak, visibility("default"))) float __expf_finite(float x) { return expf(x); }
__attribute__((weak, visibility("default"))) float __exp2f_finite(float x) { return exp2f(x); }
__attribute__((weak, visibility("default"))) float __logf_finite(float x) { return logf(x); }
__attribute__((weak, visibility("default"))) float __log2f_finite(float x) { return log2f(x); }
__attribute__((weak, visibility("default"))) float __log10f_finite(float x) { return log10f(x); }
__attribute__((weak, visibility("default"))) float __powf_finite(float x, float y) { return powf(x, y); }
__attribute__((weak, visibility("default"))) void sincos(double x, double *s, double *c) { *s = sin(x); *c = cos(x); }
__attribute__((weak, visibility("default"))) void __sincos(double x, double *s, double *c) { *s = sin(x); *c = cos(x); }
__attribute__((weak, visibility("default"))) void sincosf(float x, float *s, float *c) { *s = sinf(x); *c = cosf(x); }
__attribute__((weak, visibility("default"))) void __sincosf(float x, float *s, float *c) { *s = sinf(x); *c = cosf(x); }
__attribute__((weak, visibility("default"))) void *aligned_alloc(size_t alignment, size_t size) { void *p = NULL; return posix_memalign(&p, alignment, size) == 0 ? p : NULL; }

static unsigned short __ctype_b_tab[384];
static int32_t __ctype_tolower_tab[384];
static int32_t __ctype_toupper_tab[384];
static const unsigned short *__ctype_b_ptr = &__ctype_b_tab[128];
static const int32_t *__ctype_tolower_ptr = &__ctype_tolower_tab[128];
static const int32_t *__ctype_toupper_ptr = &__ctype_toupper_tab[128];

__attribute__((constructor(101))) static void __init_ctype_tables(void) {
    for (int i = 0; i < 256; ++i) {
        unsigned short flags = 0;
        if (isupper(i)) flags |= 0x0100;
        if (islower(i)) flags |= 0x0200;
        if (isalpha(i)) flags |= 0x0400;
        if (isdigit(i)) flags |= 0x0800;
        if (isxdigit(i)) flags |= 0x1000;
        if (isspace(i)) flags |= 0x2000;
        if (isprint(i)) flags |= 0x4000;
        if (isgraph(i)) flags |= 0x8000;
        if (isblank(i)) flags |= 0x0001;
        if (iscntrl(i)) flags |= 0x0002;
        if (ispunct(i)) flags |= 0x0004;
        if (isalnum(i)) flags |= 0x0008;
        __ctype_b_tab[128 + i] = flags;
        __ctype_tolower_tab[128 + i] = tolower(i);
        __ctype_toupper_tab[128 + i] = toupper(i);
    }
}

__attribute__((weak, visibility("default"))) const unsigned short **__ctype_b_loc(void) { return &__ctype_b_ptr; }
__attribute__((weak, visibility("default"))) const int32_t **__ctype_tolower_loc(void) { return &__ctype_tolower_ptr; }
__attribute__((weak, visibility("default"))) const int32_t **__ctype_toupper_loc(void) { return &__ctype_toupper_ptr; }
__attribute__((weak, visibility("default"))) size_t __ctype_get_mb_cur_max(void) { return 4; }

__attribute__((weak, visibility("default"))) int getservbyname_r(const char *n, const char *p, struct servent *r, char *b, size_t l, struct servent **res) { (void)b; (void)l; struct servent *s = getservbyname(n, p); if (!s) { *res = NULL; return ENOENT; } *r = *s; *res = r; return 0; }
__attribute__((weak, visibility("default"))) int getservbyport_r(int port, const char *p, struct servent *r, char *b, size_t l, struct servent **res) { (void)b; (void)l; struct servent *s = getservbyport(port, p); if (!s) { *res = NULL; return ENOENT; } *r = *s; *res = r; return 0; }
__attribute__((weak, visibility("default"))) int getprotobyname_r(const char *n, struct protoent *r, char *b, size_t l, struct protoent **res) { (void)b; (void)l; struct protoent *p = getprotobyname(n); if (!p) { *res = NULL; return ENOENT; } *r = *p; *res = r; return 0; }
__attribute__((weak, visibility("default"))) int getprotobynumber_r(int proto, struct protoent *r, char *b, size_t l, struct protoent **res) { (void)b; (void)l; struct protoent *p = getprotobynumber(proto); if (!p) { *res = NULL; return ENOENT; } *r = *p; *res = r; return 0; }
__attribute__((weak, visibility("default"))) int gethostbyname_r(const char *name, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop) { (void)buf; (void)buflen; struct hostent *hp = gethostbyname(name); if (!hp) { *result = NULL; if (h_errnop) *h_errnop = 1; return ENOENT; } *ret = *hp; *result = ret; return 0; }
__attribute__((weak, visibility("default"))) int gethostbyname2_r(const char *name, int af, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop) { (void)af; return gethostbyname_r(name, ret, buf, buflen, result, h_errnop); }
__attribute__((weak, visibility("default"))) int gethostbyaddr_r(const void *addr, socklen_t len, int type, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop) { (void)buf; (void)buflen; struct hostent *hp = gethostbyaddr(addr, len, type); if (!hp) { *result = NULL; if (h_errnop) *h_errnop = 1; return ENOENT; } *ret = *hp; *result = ret; return 0; }

__attribute__((weak, visibility("default"))) const char *gnu_get_libc_version(void) { return "2.38"; }
__attribute__((weak, visibility("default"))) const char *gnu_get_libc_release(void) { return "stable"; }
__attribute__((weak, visibility("default"))) int __cxa_thread_atexit_impl(void (*func)(void *), void *obj, void *dso_symbol) {
    typedef int (*fn_t)(void (*)(void*), void*, void*);
    static fn_t real_fn = (fn_t)-1;
    if (real_fn == (fn_t)-1) {
        void *sym = dlsym(RTLD_NEXT, "__cxa_thread_atexit_impl");
        if (sym == (void*)__cxa_thread_atexit_impl) sym = NULL;
        real_fn = (fn_t)sym;
    }
    if (real_fn) return real_fn(func, obj, dso_symbol);
    return 0;
}

__attribute__((weak, visibility("default"))) int __isoc99_sscanf(const char *str, const char *format, ...) { va_list ap; va_start(ap, format); int r = vsscanf(str, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __isoc99_vsscanf(const char *str, const char *format, va_list ap) { return vsscanf(str, format, ap); }
__attribute__((weak, visibility("default"))) int __isoc99_fscanf(FILE *stream, const char *format, ...) { va_list ap; va_start(ap, format); int r = vfscanf(stream, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __isoc99_vfscanf(FILE *stream, const char *format, va_list ap) { return vfscanf(stream, format, ap); }
__attribute__((weak, visibility("default"))) int __isoc99_scanf(const char *format, ...) { va_list ap; va_start(ap, format); int r = vscanf(format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __isoc99_vscanf(const char *format, va_list ap) { return vscanf(format, ap); }
__attribute__((weak, visibility("default"))) int __isoc23_sscanf(const char *str, const char *format, ...) { va_list ap; va_start(ap, format); int r = vsscanf(str, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __isoc23_vsscanf(const char *str, const char *format, va_list ap) { return vsscanf(str, format, ap); }
__attribute__((weak, visibility("default"))) int __isoc23_fscanf(FILE *stream, const char *format, ...) { va_list ap; va_start(ap, format); int r = vfscanf(stream, format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __isoc23_vfscanf(FILE *stream, const char *format, va_list ap) { return vfscanf(stream, format, ap); }
__attribute__((weak, visibility("default"))) int __isoc23_scanf(const char *format, ...) { va_list ap; va_start(ap, format); int r = vscanf(format, ap); va_end(ap); return r; }
__attribute__((weak, visibility("default"))) int __isoc23_vscanf(const char *format, va_list ap) { return vscanf(format, ap); }
__attribute__((weak, visibility("default"))) long __isoc23_strtol(const char *n, char **e, int b) { return strtol(n, e, b); }
__attribute__((weak, visibility("default"))) unsigned long __isoc23_strtoul(const char *n, char **e, int b) { return strtoul(n, e, b); }
__attribute__((weak, visibility("default"))) long long __isoc23_strtoll(const char *n, char **e, int b) { return strtoll(n, e, b); }
__attribute__((weak, visibility("default"))) unsigned long long __isoc23_strtoull(const char *n, char **e, int b) { return strtoull(n, e, b); }
__attribute__((weak, visibility("default"))) float __isoc23_strtof(const char *n, char **e) { return strtof(n, e); }
__attribute__((weak, visibility("default"))) double __isoc23_strtod(const char *n, char **e) { return strtod(n, e); }
__attribute__((weak, visibility("default"))) long double __isoc23_strtold(const char *n, char **e) { return strtold(n, e); }

__attribute__((weak, visibility("default"))) int bcmp(const void *s1, const void *s2, size_t n) { return memcmp(s1, s2, n); }
__attribute__((weak, visibility("default"))) void bcopy(const void *src, void *dest, size_t n) { memmove(dest, src, n); }
__attribute__((weak, visibility("default"))) void bzero(void *s, size_t n) { memset(s, 0, n); }

#ifndef WRDE_NOCMD
#define WRDE_NOCMD 0
typedef struct { size_t we_wordc; char **we_wordv; size_t we_offs; } wordexp_t;
static inline int wordexp(const char *w, wordexp_t *p, int f) { (void)w; (void)p; (void)f; return -1; }
static inline void wordfree(wordexp_t *p) { (void)p; }
#endif

#ifdef __cplusplus
}
#endif


