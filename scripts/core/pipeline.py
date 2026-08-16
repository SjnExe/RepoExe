import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from builders.alpine import build_alpine
from builders.debian import build_deb
from builders.npm import build_npm
from builders.pacman import build_pacman
from builders.pip import build_pip
from core.fetcher import resolve_and_fetch_build_dependencies
from core.subpkg import process_subpackages
from sanitizer.elf import sanitize_staging_elfs
from sanitizer.shebang import sanitize_shebangs
from utils.elf_linter import audit_directory_elfs
from utils.test import ProotTestRunner
from utils.toolchains import setup_build_environment

DEFAULT_BIONIC_ENV = {
    "CFLAGS": "-O3 -DNDEBUG -pipe -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC -fPIE -include /tmp/bionic_stub.h",
    "CXXFLAGS": "-O3 -DNDEBUG -pipe -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC -fPIE -include /tmp/bionic_stub.h",
    "LDFLAGS": "-pie -fuse-ld=lld -static-libgcc -Wl,-O1 -Wl,--as-needed -Wl,-z,relro -Wl,-z,now -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--threads=4 -L/tmp -lbionic_compat",
    "CARGO_BUILD_TARGET": "aarch64-linux-android",
    "GOOS": "android",
    "GOARCH": "arm64",
    "CGO_ENABLED": "1",
    "TMPDIR": "/tmp",
    "GOTMPDIR": "/tmp",
    "RUSTUP_HOME": "/home/builder/.rustup",
    "CARGO_HOME": "/home/builder/.cargo",
    "RUSTUP_TOOLCHAIN": "stable",
    "RUSTC_BOOTSTRAP": "1",
    "GIT_CONFIG_COUNT": "1",
    "GIT_CONFIG_KEY_0": "safe.directory",
    "GIT_CONFIG_VALUE_0": "*",
}


def resolve_ndk_tool(tool_name: str) -> str:
    """Dynamically locates an NDK tool binary in the environment or NDK filesystem."""
    if tool_name in os.environ and (
        Path(os.environ[tool_name]).exists() or shutil.which(os.environ[tool_name])
    ):
        return os.environ[tool_name]

    ndk_path = Path(os.environ.get("NDK", "/opt/android-ndk"))
    if ndk_path.exists():
        matches = list(ndk_path.rglob(tool_name))
        if matches:
            return str(matches[0])

    return shutil.which(tool_name) or tool_name


def setup_bionic_compat() -> None:
    ndk_clang = resolve_ndk_tool("aarch64-linux-android24-clang")
    ndk_ar = resolve_ndk_tool("llvm-ar")
    if ndk_ar == "llvm-ar" and not shutil.which("llvm-ar"):
        ndk_ar = resolve_ndk_tool("ar")

    compat_c = Path("/tmp/bionic_compat.c")
    compat_c.write_text(
        "#include <stddef.h>\n"
        "#include <stdint.h>\n"
        "#include <stdbool.h>\n"
        "#include <string.h>\n"
        "#include <stdio.h>\n"
        "#include <stdlib.h>\n"
        "#include <stdarg.h>\n"
        "#include <time.h>\n"
        "#include <sys/time.h>\n"
        "#include <sys/stat.h>\n"
        "#include <sys/types.h>\n"
        "#include <sys/syscall.h>\n"
        "#include <sys/resource.h>\n"
        "#include <sys/socket.h>\n"
        "#include <sys/mman.h>\n"
        "#include <sys/uio.h>\n"
        "#include <fcntl.h>\n"
        "#include <unistd.h>\n"
        "#include <pthread.h>\n"
        "#include <signal.h>\n"
        "#include <sched.h>\n"
        "#include <ctype.h>\n"
        "#include <wctype.h>\n"
        "#include <wchar.h>\n"
        "#include <locale.h>\n"
        "#include <langinfo.h>\n"
        "#include <netdb.h>\n"
        "#include <math.h>\n"
        "#include <errno.h>\n"
        "extern char **environ;\n"
        '__attribute__((weak, visibility("default"))) int *__errno(void) { return &errno; }\n'
        '__attribute__((weak, visibility("default"))) int *__errno_location(void) { return __errno(); }\n'
        '__attribute__((weak, visibility("default"))) int *__h_errno_location(void) { return __errno(); }\n'
        '__attribute__((weak, visibility("default"))) int *__get_h_errno(void) { return __errno(); }\n'
        '__attribute__((weak, visibility("default"))) int *__h_errno(void) { return __errno(); }\n'
        '__attribute__((weak, visibility("default"))) int __libc_start_main(\n'
        "    int (*main)(int, char **, char **),\n"
        "    int argc,\n"
        "    char **argv,\n"
        "    void (*init)(void),\n"
        "    void (*fini)(void),\n"
        "    void (*rtld_fini)(void),\n"
        "    void *stack_end\n"
        ") {\n"
        "    if (init) init();\n"
        "    int ret = main(argc, argv, environ);\n"
        "    if (fini) fini();\n"
        "    if (rtld_fini) rtld_fini();\n"
        "    exit(ret);\n"
        "}\n"
        '__attribute__((weak, visibility("default"))) int backtrace(void **b, int s) { (void)b; (void)s; return 0; }\n'
        '__attribute__((weak, visibility("default"))) char **backtrace_symbols(void *const *b, int s) { (void)b; (void)s; return NULL; }\n'
        '__attribute__((weak, visibility("default"))) void backtrace_symbols_fd(void *const *b, int s, int f) { (void)b; (void)s; (void)f; }\n'
        '__attribute__((weak, visibility("default"))) int pthread_getname_np(pthread_t t, char *n, size_t s) { (void)t; (void)n; (void)s; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int pthread_cond_clockwait(pthread_cond_t *c, pthread_mutex_t *m, clockid_t clock_id, const struct timespec *ts) { (void)clock_id; return pthread_cond_timedwait(c, m, ts); }\n'
        '__attribute__((weak, visibility("default"))) int pthread_setcancelstate(int state, int *oldstate) { if (oldstate) *oldstate = state; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int pthread_setcanceltype(int type, int *oldtype) { if (oldtype) *oldtype = type; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int pthread_cancel(pthread_t thread) { (void)thread; return 0; }\n'
        '__attribute__((weak, visibility("default"))) void pthread_testcancel(void) {}\n'
        '__attribute__((weak, visibility("default"))) int pthread_yield(void) { return sched_yield(); }\n'
        '__attribute__((weak, visibility("default"))) int pthread_getattr_np(pthread_t th, pthread_attr_t *attr) { (void)th; (void)attr; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int sigtimedwait(const sigset_t *set, siginfo_t *info, const struct timespec *timeout) { (void)set; (void)info; (void)timeout; errno = ENOSYS; return -1; }\n'
        '__attribute__((weak, visibility("default"))) int sigwaitinfo(const sigset_t *set, siginfo_t *info) { (void)set; (void)info; errno = ENOSYS; return -1; }\n'
        '__attribute__((weak, visibility("default"))) int __xstat(int ver, const char *path, struct stat *stat_buf) { (void)ver; return stat(path, stat_buf); }\n'
        '__attribute__((weak, visibility("default"))) int __fxstat(int ver, int fd, struct stat *stat_buf) { (void)ver; return fstat(fd, stat_buf); }\n'
        '__attribute__((weak, visibility("default"))) int __lxstat(int ver, const char *path, struct stat *stat_buf) { (void)ver; return lstat(path, stat_buf); }\n'
        '__attribute__((weak, visibility("default"))) int __fxstatat(int ver, int dirfd, const char *path, struct stat *stat_buf, int flags) { (void)ver; return fstatat(dirfd, path, stat_buf, flags); }\n'
        '__attribute__((weak, visibility("default"))) int __xstat64(int ver, const char *path, void *stat_buf) { (void)ver; return stat(path, (struct stat *)stat_buf); }\n'
        '__attribute__((weak, visibility("default"))) int __fxstat64(int ver, int fd, void *stat_buf) { (void)ver; return fstat(fd, (struct stat *)stat_buf); }\n'
        '__attribute__((weak, visibility("default"))) int __lxstat64(int ver, const char *path, void *stat_buf) { (void)ver; return lstat(path, (struct stat *)stat_buf); }\n'
        '__attribute__((weak, visibility("default"))) int __fxstatat64(int ver, int dirfd, const char *path, void *stat_buf, int flags) { (void)ver; return fstatat(dirfd, path, (struct stat *)stat_buf, flags); }\n'
        '__attribute__((weak, visibility("default"))) int __xmknod(int ver, const char *path, mode_t mode, dev_t *dev) { (void)ver; return mknod(path, mode, *dev); }\n'
        '__attribute__((weak, visibility("default"))) int __xmknodat(int ver, int dirfd, const char *path, mode_t mode, dev_t *dev) { (void)ver; return mknodat(dirfd, path, mode, *dev); }\n'
        '__attribute__((weak, visibility("default"))) int lchmod(const char *path, mode_t mode) { return fchmodat(AT_FDCWD, path, mode, AT_SYMLINK_NOFOLLOW); }\n'
        '__attribute__((weak, visibility("default"))) int futimes(int fd, const struct timeval tv[2]) { struct timespec ts[2]; if (!tv) return futimens(fd, NULL); ts[0].tv_sec = tv[0].tv_sec; ts[0].tv_nsec = tv[0].tv_usec * 1000; ts[1].tv_sec = tv[1].tv_sec; ts[1].tv_nsec = tv[1].tv_usec * 1000; return futimens(fd, ts); }\n'
        '__attribute__((weak, visibility("default"))) int lutimes(const char *path, const struct timeval tv[2]) { struct timespec ts[2]; if (!tv) return utimensat(AT_FDCWD, path, NULL, AT_SYMLINK_NOFOLLOW); ts[0].tv_sec = tv[0].tv_sec; ts[0].tv_nsec = tv[0].tv_usec * 1000; ts[1].tv_sec = tv[1].tv_sec; ts[1].tv_nsec = tv[1].tv_usec * 1000; return utimensat(AT_FDCWD, path, ts, AT_SYMLINK_NOFOLLOW); }\n'
        '__attribute__((weak, visibility("default"))) int posix_fadvise(int fd, off_t offset, off_t len, int advice) { (void)fd; (void)offset; (void)len; (void)advice; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int posix_fallocate(int fd, off_t offset, off_t len) { return fallocate(fd, 0, offset, len); }\n'
        '__attribute__((weak, visibility("default"))) int getloadavg(double loadavg[], int nelem) { for (int i = 0; i < nelem; ++i) loadavg[i] = 0.0; return nelem; }\n'
        '__attribute__((weak, visibility("default"))) int malloc_trim(size_t pad) { (void)pad; return 0; }\n'
        '__attribute__((weak, visibility("default"))) void malloc_stats(void) {}\n'
        '__attribute__((weak, visibility("default"))) int mallopt(int param, int value) { (void)param; (void)value; return 1; }\n'
        '__attribute__((weak, visibility("default"))) char *secure_getenv(const char *name) { return getenv(name); }\n'
        '__attribute__((weak, visibility("default"))) char *__secure_getenv(const char *name) { return getenv(name); }\n'
        '__attribute__((weak, visibility("default"))) int clearenv(void) { if (environ) *environ = NULL; return 0; }\n'
        '__attribute__((weak, visibility("default"))) char *strchrnul(const char *s, int c) { while (*s && *s != (char)c) s++; return (char *)s; }\n'
        '__attribute__((weak, visibility("default"))) char *__strchrnul(const char *s, int c) { return strchrnul(s, c); }\n'
        '__attribute__((weak, visibility("default"))) void *rawmemchr(const void *s, int c) { const unsigned char *p = (const unsigned char *)s; while (*p != (unsigned char)c) p++; return (void *)p; }\n'
        '__attribute__((weak, visibility("default"))) void *__rawmemchr(const void *s, int c) { return rawmemchr(s, c); }\n'
        '__attribute__((weak, visibility("default"))) void *mempcpy(void *dest, const void *src, size_t n) { return (void *)((char *)memcpy(dest, src, n) + n); }\n'
        '__attribute__((weak, visibility("default"))) void *__mempcpy(void *dest, const void *src, size_t n) { return mempcpy(dest, src, n); }\n'
        '__attribute__((weak, visibility("default"))) wchar_t *wmempcpy(wchar_t *dest, const wchar_t *src, size_t n) { return (wchar_t *)wmemcpy(dest, src, n) + n; }\n'
        '__attribute__((weak, visibility("default"))) char *canonicalize_file_name(const char *path) { return realpath(path, NULL); }\n'
        '__attribute__((weak, visibility("default"))) int sync_file_range(int fd, off64_t offset, off64_t nbytes, unsigned int flags) { (void)fd; (void)offset; (void)nbytes; (void)flags; return 0; }\n'
        '__attribute__((weak, visibility("default"))) char *__strdup(const char *s) { return strdup(s); }\n'
        '__attribute__((weak, visibility("default"))) char *__strndup(const char *s, size_t n) { return strndup(s, n); }\n'
        '__attribute__((weak, visibility("default"))) char *__strtok_r(char *s, const char *d, char **p) { return strtok_r(s, d, p); }\n'
        '__attribute__((weak, visibility("default"))) int __asprintf(char **strp, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vasprintf(strp, fmt, ap); va_end(ap); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __vasprintf(char **strp, const char *fmt, va_list ap) { return vasprintf(strp, fmt, ap); }\n'
        '__attribute__((weak, visibility("default"))) int __dprintf(int fd, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vdprintf(fd, fmt, ap); va_end(ap); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __vdprintf(int fd, const char *fmt, va_list ap) { return vdprintf(fd, fmt, ap); }\n'
        '__attribute__((weak, visibility("default"))) int strcoll_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcoll(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) int __strcoll_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcoll(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) size_t strxfrm_l(char *dest, const char *src, size_t n, locale_t loc) { (void)loc; return strxfrm(dest, src, n); }\n'
        '__attribute__((weak, visibility("default"))) size_t __strxfrm_l(char *dest, const char *src, size_t n, locale_t loc) { (void)loc; return strxfrm(dest, src, n); }\n'
        '__attribute__((weak, visibility("default"))) int wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscoll(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) int __wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscoll(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) size_t wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc) { (void)loc; return wcsxfrm(dest, src, n); }\n'
        '__attribute__((weak, visibility("default"))) size_t __wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc) { (void)loc; return wcsxfrm(dest, src, n); }\n'
        '__attribute__((weak, visibility("default"))) int strcasecmp_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcasecmp(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) int __strcasecmp_l(const char *s1, const char *s2, locale_t loc) { (void)loc; return strcasecmp(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) int strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc) { (void)loc; return strncasecmp(s1, s2, n); }\n'
        '__attribute__((weak, visibility("default"))) int __strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc) { (void)loc; return strncasecmp(s1, s2, n); }\n'
        '__attribute__((weak, visibility("default"))) int wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscasecmp(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) int __wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc) { (void)loc; return wcscasecmp(s1, s2); }\n'
        '__attribute__((weak, visibility("default"))) int wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc) { (void)loc; return wcsncasecmp(s1, s2, n); }\n'
        '__attribute__((weak, visibility("default"))) int __wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc) { (void)loc; return wcsncasecmp(s1, s2, n); }\n'
        '__attribute__((weak, visibility("default"))) int toupper_l(int c, locale_t loc) { (void)loc; return toupper(c); }\n'
        '__attribute__((weak, visibility("default"))) int __toupper_l(int c, locale_t loc) { (void)loc; return toupper(c); }\n'
        '__attribute__((weak, visibility("default"))) int tolower_l(int c, locale_t loc) { (void)loc; return tolower(c); }\n'
        '__attribute__((weak, visibility("default"))) int __tolower_l(int c, locale_t loc) { (void)loc; return tolower(c); }\n'
        '__attribute__((weak, visibility("default"))) wint_t towupper_l(wint_t wc, locale_t loc) { (void)loc; return towupper(wc); }\n'
        '__attribute__((weak, visibility("default"))) wint_t __towupper_l(wint_t wc, locale_t loc) { (void)loc; return towupper(wc); }\n'
        '__attribute__((weak, visibility("default"))) wint_t towlower_l(wint_t wc, locale_t loc) { (void)loc; return towlower(wc); }\n'
        '__attribute__((weak, visibility("default"))) wint_t __towlower_l(wint_t wc, locale_t loc) { (void)loc; return towlower(wc); }\n'
        '__attribute__((weak, visibility("default"))) int iswalpha_l(wint_t wc, locale_t loc) { (void)loc; return iswalpha(wc); }\n'
        '__attribute__((weak, visibility("default"))) int __iswalpha_l(wint_t wc, locale_t loc) { (void)loc; return iswalpha(wc); }\n'
        '__attribute__((weak, visibility("default"))) int iswdigit_l(wint_t wc, locale_t loc) { (void)loc; return iswdigit(wc); }\n'
        '__attribute__((weak, visibility("default"))) int __iswdigit_l(wint_t wc, locale_t loc) { (void)loc; return iswdigit(wc); }\n'
        '__attribute__((weak, visibility("default"))) int iswspace_l(wint_t wc, locale_t loc) { (void)loc; return iswspace(wc); }\n'
        '__attribute__((weak, visibility("default"))) int __iswspace_l(wint_t wc, locale_t loc) { (void)loc; return iswspace(wc); }\n'
        '__attribute__((weak, visibility("default"))) int iswctype_l(wint_t wc, wctype_t desc, locale_t loc) { (void)loc; return iswctype(wc, desc); }\n'
        '__attribute__((weak, visibility("default"))) int __iswctype_l(wint_t wc, wctype_t desc, locale_t loc) { (void)loc; return iswctype(wc, desc); }\n'
        '__attribute__((weak, visibility("default"))) wctype_t wctype_l(const char *name, locale_t loc) { (void)loc; return wctype(name); }\n'
        '__attribute__((weak, visibility("default"))) wctype_t __wctype_l(const char *name, locale_t loc) { (void)loc; return wctype(name); }\n'
        '__attribute__((weak, visibility("default"))) double strtod_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtod(nptr, endptr); }\n'
        '__attribute__((weak, visibility("default"))) double __strtod_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtod(nptr, endptr); }\n'
        '__attribute__((weak, visibility("default"))) float strtof_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtof(nptr, endptr); }\n'
        '__attribute__((weak, visibility("default"))) float __strtof_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtof(nptr, endptr); }\n'
        '__attribute__((weak, visibility("default"))) long double strtold_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtold(nptr, endptr); }\n'
        '__attribute__((weak, visibility("default"))) long double __strtold_l(const char *nptr, char **endptr, locale_t loc) { (void)loc; return strtold(nptr, endptr); }\n'
        '__attribute__((weak, visibility("default"))) long strtol_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtol(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) long __strtol_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtol(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) unsigned long strtoul_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoul(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) unsigned long __strtoul_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoul(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) long long strtoll_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoll(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) long long __strtoll_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoll(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) unsigned long long strtoull_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoull(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) unsigned long long __strtoull_l(const char *nptr, char **endptr, int base, locale_t loc) { (void)loc; return strtoull(nptr, endptr, base); }\n'
        '__attribute__((weak, visibility("default"))) char *nl_langinfo_l(nl_item item, locale_t loc) { (void)loc; return nl_langinfo(item); }\n'
        '__attribute__((weak, visibility("default"))) char *__nl_langinfo_l(nl_item item, locale_t loc) { (void)loc; return nl_langinfo(item); }\n'
        '__attribute__((weak, visibility("default"))) size_t strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc) { (void)loc; return strftime(s, max, fmt, tm); }\n'
        '__attribute__((weak, visibility("default"))) size_t __strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc) { (void)loc; return strftime(s, max, fmt, tm); }\n'
        '__attribute__((weak, visibility("default"))) size_t wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc) { (void)loc; return wcsftime(s, max, fmt, tm); }\n'
        '__attribute__((weak, visibility("default"))) size_t __wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc) { (void)loc; return wcsftime(s, max, fmt, tm); }\n'
        '__attribute__((weak, visibility("default"))) double __exp_finite(double x) { return exp(x); }\n'
        '__attribute__((weak, visibility("default"))) double __exp2_finite(double x) { return exp2(x); }\n'
        '__attribute__((weak, visibility("default"))) double __log_finite(double x) { return log(x); }\n'
        '__attribute__((weak, visibility("default"))) double __log2_finite(double x) { return log2(x); }\n'
        '__attribute__((weak, visibility("default"))) double __log10_finite(double x) { return log10(x); }\n'
        '__attribute__((weak, visibility("default"))) double __pow_finite(double x, double y) { return pow(x, y); }\n'
        '__attribute__((weak, visibility("default"))) float __expf_finite(float x) { return expf(x); }\n'
        '__attribute__((weak, visibility("default"))) float __exp2f_finite(float x) { return exp2f(x); }\n'
        '__attribute__((weak, visibility("default"))) float __logf_finite(float x) { return logf(x); }\n'
        '__attribute__((weak, visibility("default"))) float __log2f_finite(float x) { return log2f(x); }\n'
        '__attribute__((weak, visibility("default"))) float __log10f_finite(float x) { return log10f(x); }\n'
        '__attribute__((weak, visibility("default"))) float __powf_finite(float x, float y) { return powf(x, y); }\n'
        '__attribute__((weak, visibility("default"))) void sincos(double x, double *s, double *c) { *s = sin(x); *c = cos(x); }\n'
        '__attribute__((weak, visibility("default"))) void __sincos(double x, double *s, double *c) { *s = sin(x); *c = cos(x); }\n'
        '__attribute__((weak, visibility("default"))) void sincosf(float x, float *s, float *c) { *s = sinf(x); *c = cosf(x); }\n'
        '__attribute__((weak, visibility("default"))) void __sincosf(float x, float *s, float *c) { *s = sinf(x); *c = cosf(x); }\n'
        '__attribute__((weak, visibility("default"))) int sched_getcpu(void) { return 0; }\n'
        '__attribute__((weak, visibility("default"))) long __timezone = 0;\n'
        '__attribute__((weak, visibility("default"))) long timezone = 0;\n'
        '__attribute__((weak, visibility("default"))) int daylight = 0;\n'
        '__attribute__((weak, visibility("default"))) int __daylight = 0;\n'
        '__attribute__((weak, visibility("default"))) char *tzname[2] = {"UTC", "UTC"};\n'
        '__attribute__((weak, visibility("default"))) char **__tzname = tzname;\n'
        '__attribute__((weak, visibility("default"))) const char *gnu_get_libc_version(void) { return "2.38"; }\n'
        '__attribute__((weak, visibility("default"))) const char *gnu_get_libc_release(void) { return "stable"; }\n'
        '__attribute__((weak, visibility("default"))) int __cxa_thread_atexit_impl(void (*func)(void *), void *obj, void *dso_symbol) { (void)func; (void)obj; (void)dso_symbol; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int __isoc99_sscanf(const char *str, const char *format, ...) { va_list a; va_start(a, format); int r = vsscanf(str, format, a); va_end(a); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __isoc99_vsscanf(const char *str, const char *format, va_list ap) { return vsscanf(str, format, ap); }\n'
        '__attribute__((weak, visibility("default"))) int __isoc99_fscanf(FILE *stream, const char *format, ...) { va_list a; va_start(a, format); int r = vfscanf(stream, format, a); va_end(a); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __isoc99_vfscanf(FILE *stream, const char *format, va_list ap) { return vfscanf(stream, format, ap); }\n'
        '__attribute__((weak, visibility("default"))) int __isoc99_scanf(const char *format, ...) { va_list a; va_start(a, format); int r = vscanf(format, a); va_end(a); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __isoc99_vscanf(const char *format, va_list ap) { return vscanf(format, ap); }\n'
        '__attribute__((weak, visibility("default"))) int __isoc23_sscanf(const char *str, const char *format, ...) { va_list a; va_start(a, format); int r = vsscanf(str, format, a); va_end(a); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __isoc23_vsscanf(const char *str, const char *format, va_list ap) { return vsscanf(str, format, ap); }\n'
        '__attribute__((weak, visibility("default"))) int __isoc23_fscanf(FILE *stream, const char *format, ...) { va_list a; va_start(a, format); int r = vfscanf(stream, format, a); va_end(a); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __isoc23_vfscanf(FILE *stream, const char *format, va_list ap) { return vfscanf(stream, format, ap); }\n'
        '__attribute__((weak, visibility("default"))) int __isoc23_scanf(const char *format, ...) { va_list a; va_start(a, format); int r = vscanf(format, a); va_end(a); return r; }\n'
        '__attribute__((weak, visibility("default"))) int __isoc23_vscanf(const char *format, va_list ap) { return vscanf(format, ap); }\n'
        '__attribute__((weak, visibility("default"))) long __isoc23_strtol(const char *n, char **e, int b) { return strtol(n, e, b); }\n'
        '__attribute__((weak, visibility("default"))) unsigned long __isoc23_strtoul(const char *n, char **e, int b) { return strtoul(n, e, b); }\n'
        '__attribute__((weak, visibility("default"))) long long __isoc23_strtoll(const char *n, char **e, int b) { return strtoll(n, e, b); }\n'
        '__attribute__((weak, visibility("default"))) unsigned long long __isoc23_strtoull(const char *n, char **e, int b) { return strtoull(n, e, b); }\n'
        '__attribute__((weak, visibility("default"))) float __isoc23_strtof(const char *n, char **e) { return strtof(n, e); }\n'
        '__attribute__((weak, visibility("default"))) double __isoc23_strtod(const char *n, char **e) { return strtod(n, e); }\n'
        '__attribute__((weak, visibility("default"))) long double __isoc23_strtold(const char *n, char **e) { return strtold(n, e); }\n'
        '__attribute__((weak, visibility("default"))) int bcmp(const void *s1, const void *s2, size_t n) { return memcmp(s1, s2, n); }\n'
        '__attribute__((weak, visibility("default"))) void bcopy(const void *src, void *dest, size_t n) { memmove(dest, src, n); }\n'
        '__attribute__((weak, visibility("default"))) void bzero(void *s, size_t n) { memset(s, 0, n); }\n'
        '__attribute__((weak, visibility("default"))) void *reallocarray(void *ptr, size_t nmemb, size_t size) { if (size && nmemb > ((size_t)-1) / size) { errno = ENOMEM; return NULL; } return realloc(ptr, nmemb * size); }\n'
        "static const unsigned short *__ctype_b_ptr = NULL;\n"
        "static const int32_t *__ctype_tolower_ptr = NULL;\n"
        "static const int32_t *__ctype_toupper_ptr = NULL;\n"
        "static unsigned short __ctype_b_tab[384];\n"
        "static int32_t __ctype_tolower_tab[384];\n"
        "static int32_t __ctype_toupper_tab[384];\n"
        "static void __init_ctype_tables(void) {\n"
        "    if (__ctype_b_ptr) return;\n"
        "    for (int i = 0; i < 256; ++i) {\n"
        "        unsigned short flags = 0;\n"
        "        if (isupper(i)) flags |= 0x0100;\n"
        "        if (islower(i)) flags |= 0x0200;\n"
        "        if (isalpha(i)) flags |= 0x0400;\n"
        "        if (isdigit(i)) flags |= 0x0800;\n"
        "        if (isxdigit(i)) flags |= 0x1000;\n"
        "        if (isspace(i)) flags |= 0x2000;\n"
        "        if (isprint(i)) flags |= 0x4000;\n"
        "        if (isgraph(i)) flags |= 0x8000;\n"
        "        if (isblank(i)) flags |= 0x0001;\n"
        "        if (iscntrl(i)) flags |= 0x0002;\n"
        "        if (ispunct(i)) flags |= 0x0004;\n"
        "        if (isalnum(i)) flags |= 0x0008;\n"
        "        __ctype_b_tab[128 + i] = flags;\n"
        "        __ctype_tolower_tab[128 + i] = tolower(i);\n"
        "        __ctype_toupper_tab[128 + i] = toupper(i);\n"
        "    }\n"
        "    __ctype_b_ptr = &__ctype_b_tab[128];\n"
        "    __ctype_tolower_ptr = &__ctype_tolower_tab[128];\n"
        "    __ctype_toupper_ptr = &__ctype_toupper_tab[128];\n"
        "}\n"
        '__attribute__((weak, visibility("default"))) const unsigned short **__ctype_b_loc(void) { __init_ctype_tables(); return &__ctype_b_ptr; }\n'
        '__attribute__((weak, visibility("default"))) const int32_t **__ctype_tolower_loc(void) { __init_ctype_tables(); return &__ctype_tolower_ptr; }\n'
        '__attribute__((weak, visibility("default"))) const int32_t **__ctype_toupper_loc(void) { __init_ctype_tables(); return &__ctype_toupper_ptr; }\n'
        '__attribute__((weak, visibility("default"))) size_t __ctype_get_mb_cur_max(void) { return 4; }\n'
        '__attribute__((weak, visibility("default"))) int getservbyname_r(const char *n, const char *p, struct servent *r, char *b, size_t l, struct servent **res) { struct servent *s = getservbyname(n, p); if (!s) { *res = NULL; return ENOENT; } *r = *s; *res = r; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int getservbyport_r(int port, const char *p, struct servent *r, char *b, size_t l, struct servent **res) { struct servent *s = getservbyport(port, p); if (!s) { *res = NULL; return ENOENT; } *r = *s; *res = r; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int getprotobyname_r(const char *n, struct protoent *r, char *b, size_t l, struct protoent **res) { struct protoent *p = getprotobyname(n); if (!p) { *res = NULL; return ENOENT; } *r = *p; *res = r; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int getprotobynumber_r(int proto, struct protoent *r, char *b, size_t l, struct protoent **res) { struct protoent *p = getprotobynumber(proto); if (!p) { *res = NULL; return ENOENT; } *r = *p; *res = r; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int gethostbyname_r(const char *name, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop) { struct hostent *hp = gethostbyname(name); if (!hp) { *result = NULL; if (h_errnop) *h_errnop = 1; return ENOENT; } *ret = *hp; *result = ret; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int gethostbyname2_r(const char *name, int af, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop) { (void)af; return gethostbyname_r(name, ret, buf, buflen, result, h_errnop); }\n'
        '__attribute__((weak, visibility("default"))) int gethostbyaddr_r(const void *addr, socklen_t len, int type, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop) { struct hostent *hp = gethostbyaddr(addr, len, type); if (!hp) { *result = NULL; if (h_errnop) *h_errnop = 1; return ENOENT; } *ret = *hp; *result = ret; return 0; }\n',
        encoding="utf-8",
    )
    obj = Path("/tmp/bionic_compat.o")
    lib = Path("/tmp/libbionic_compat.a")
    subprocess.run(
        [ndk_clang, "-fPIC", "-c", str(compat_c), "-o", str(obj)],
        check=False,
        capture_output=True,
    )
    subprocess.run(
        [ndk_ar, "rcs", str(lib), str(obj)],
        check=False,
        capture_output=True,
    )

    stub_h = Path("/tmp/bionic_stub.h")
    stub_h.write_text(
        "#ifndef _BIONIC_STUB_H\n"
        "#define _BIONIC_STUB_H\n"
        "#include <sys/cdefs.h>\n"
        "#include <android/api-level.h>\n"
        "#include <sys/types.h>\n"
        "#include <stddef.h>\n"
        "#include <stdint.h>\n"
        "#include <string.h>\n"
        "#include <stdlib.h>\n"
        "#include <sys/time.h>\n"
        "#include <sys/stat.h>\n"
        "#include <pthread.h>\n"
        "#include <signal.h>\n"
        "#include <netdb.h>\n"
        "#include <wchar.h>\n"
        "#include <wctype.h>\n"
        "#include <locale.h>\n"
        "#include <langinfo.h>\n"
        "#include <time.h>\n"
        '#ifdef __cplusplus\nextern "C" {\n#endif\n'
        "int *__get_h_errno(void);\n"
        "int *__h_errno(void);\n"
        "int pthread_getname_np(pthread_t __pthread, char* __buf, size_t __buf_size);\n"
        "int pthread_cond_clockwait(pthread_cond_t* __cond, pthread_mutex_t* __mutex, clockid_t __clock_id, const struct timespec* __abstime);\n"
        "int pthread_setcancelstate(int state, int *oldstate);\n"
        "int pthread_setcanceltype(int type, int *oldtype);\n"
        "int pthread_cancel(pthread_t thread);\n"
        "void pthread_testcancel(void);\n"
        "int pthread_yield(void);\n"
        "int pthread_getattr_np(pthread_t th, pthread_attr_t *attr);\n"
        "int sigtimedwait(const sigset_t *set, siginfo_t *info, const struct timespec *timeout);\n"
        "int sigwaitinfo(const sigset_t *set, siginfo_t *info);\n"
        "int __xstat(int ver, const char *path, struct stat *stat_buf);\n"
        "int __fxstat(int ver, int fd, struct stat *stat_buf);\n"
        "int __lxstat(int ver, const char *path, struct stat *stat_buf);\n"
        "int __fxstatat(int ver, int dirfd, const char *path, struct stat *stat_buf, int flags);\n"
        "int __xstat64(int ver, const char *path, void *stat_buf);\n"
        "int __fxstat64(int ver, int fd, void *stat_buf);\n"
        "int __lxstat64(int ver, const char *path, void *stat_buf);\n"
        "int __fxstatat64(int ver, int dirfd, const char *path, void *stat_buf, int flags);\n"
        "int __xmknod(int ver, const char *path, mode_t mode, dev_t *dev);\n"
        "int __xmknodat(int ver, int dirfd, const char *path, mode_t mode, dev_t *dev);\n"
        "int lchmod(const char *path, mode_t mode);\n"
        "int futimes(int fd, const struct timeval tv[2]);\n"
        "int lutimes(const char *path, const struct timeval tv[2]);\n"
        "int posix_fadvise(int fd, off_t offset, off_t len, int advice);\n"
        "int posix_fallocate(int fd, off_t offset, off_t len);\n"
        "int getloadavg(double loadavg[], int nelem);\n"
        "int malloc_trim(size_t pad);\n"
        "void malloc_stats(void);\n"
        "int mallopt(int param, int value);\n"
        "char *secure_getenv(const char *name);\n"
        "char *__secure_getenv(const char *name);\n"
        "int clearenv(void);\n"
        "char *strchrnul(const char *s, int c);\n"
        "char *__strchrnul(const char *s, int c);\n"
        "void *rawmemchr(const void *s, int c);\n"
        "void *__rawmemchr(const void *s, int c);\n"
        "void *mempcpy(void *dest, const void *src, size_t n);\n"
        "void *__mempcpy(void *dest, const void *src, size_t n);\n"
        "wchar_t *wmempcpy(wchar_t *dest, const wchar_t *src, size_t n);\n"
        "char *canonicalize_file_name(const char *path);\n"
        "int sync_file_range(int fd, off64_t offset, off64_t nbytes, unsigned int flags);\n"
        "char *__strdup(const char *s);\n"
        "char *__strndup(const char *s, size_t n);\n"
        "char *__strtok_r(char *s, const char *d, char **p);\n"
        "int __asprintf(char **strp, const char *fmt, ...);\n"
        "int __vasprintf(char **strp, const char *fmt, va_list ap);\n"
        "int __dprintf(int fd, const char *fmt, ...);\n"
        "int __vdprintf(int fd, const char *fmt, va_list ap);\n"
        "int strcoll_l(const char *s1, const char *s2, locale_t loc);\n"
        "int __strcoll_l(const char *s1, const char *s2, locale_t loc);\n"
        "size_t strxfrm_l(char *dest, const char *src, size_t n, locale_t loc);\n"
        "size_t __strxfrm_l(char *dest, const char *src, size_t n, locale_t loc);\n"
        "int wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);\n"
        "int __wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);\n"
        "size_t wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc);\n"
        "size_t __wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc);\n"
        "int strcasecmp_l(const char *s1, const char *s2, locale_t loc);\n"
        "int __strcasecmp_l(const char *s1, const char *s2, locale_t loc);\n"
        "int strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc);\n"
        "int __strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc);\n"
        "int wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);\n"
        "int __wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);\n"
        "int wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc);\n"
        "int __wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc);\n"
        "int toupper_l(int c, locale_t loc);\n"
        "int __toupper_l(int c, locale_t loc);\n"
        "int tolower_l(int c, locale_t loc);\n"
        "int __tolower_l(int c, locale_t loc);\n"
        "wint_t towupper_l(wint_t wc, locale_t loc);\n"
        "wint_t __towupper_l(wint_t wc, locale_t loc);\n"
        "wint_t towlower_l(wint_t wc, locale_t loc);\n"
        "wint_t __towlower_l(wint_t wc, locale_t loc);\n"
        "int iswalpha_l(wint_t wc, locale_t loc);\n"
        "int __iswalpha_l(wint_t wc, locale_t loc);\n"
        "int iswdigit_l(wint_t wc, locale_t loc);\n"
        "int __iswdigit_l(wint_t wc, locale_t loc);\n"
        "int iswspace_l(wint_t wc, locale_t loc);\n"
        "int __iswspace_l(wint_t wc, locale_t loc);\n"
        "int iswctype_l(wint_t wc, wctype_t desc, locale_t loc);\n"
        "int __iswctype_l(wint_t wc, wctype_t desc, locale_t loc);\n"
        "wctype_t wctype_l(const char *name, locale_t loc);\n"
        "wctype_t __wctype_l(const char *name, locale_t loc);\n"
        "double strtod_l(const char *nptr, char **endptr, locale_t loc);\n"
        "double __strtod_l(const char *nptr, char **endptr, locale_t loc);\n"
        "float strtof_l(const char *nptr, char **endptr, locale_t loc);\n"
        "float __strtof_l(const char *nptr, char **endptr, locale_t loc);\n"
        "long double strtold_l(const char *nptr, char **endptr, locale_t loc);\n"
        "long double __strtold_l(const char *nptr, char **endptr, locale_t loc);\n"
        "long strtol_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "long __strtol_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "unsigned long strtoul_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "unsigned long __strtoul_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "long long strtoll_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "long long __strtoll_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "unsigned long long strtoull_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "unsigned long long __strtoull_l(const char *nptr, char **endptr, int base, locale_t loc);\n"
        "char *nl_langinfo_l(nl_item item, locale_t loc);\n"
        "char *__nl_langinfo_l(nl_item item, locale_t loc);\n"
        "size_t strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc);\n"
        "size_t __strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc);\n"
        "size_t wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc);\n"
        "size_t __wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc);\n"
        "double __exp_finite(double x);\n"
        "double __exp2_finite(double x);\n"
        "double __log_finite(double x);\n"
        "double __log2_finite(double x);\n"
        "double __log10_finite(double x);\n"
        "double __pow_finite(double x, double y);\n"
        "float __expf_finite(float x);\n"
        "float __exp2f_finite(float x);\n"
        "float __logf_finite(float x);\n"
        "float __log2f_finite(float x);\n"
        "float __log10f_finite(float x);\n"
        "float __powf_finite(float x, float y);\n"
        "void sincos(double x, double *s, double *c);\n"
        "void __sincos(double x, double *s, double *c);\n"
        "void sincosf(float x, float *s, float *c);\n"
        "void __sincosf(float x, float *s, float *c);\n"
        "int sched_getcpu(void);\n"
        "void *reallocarray(void *ptr, size_t nmemb, size_t size);\n"
        "const unsigned short **__ctype_b_loc(void);\n"
        "const int32_t **__ctype_tolower_loc(void);\n"
        "const int32_t **__ctype_toupper_loc(void);\n"
        "size_t __ctype_get_mb_cur_max(void);\n"
        "int getservbyname_r(const char *n, const char *p, struct servent *r, char *b, size_t l, struct servent **res);\n"
        "int getservbyport_r(int port, const char *p, struct servent *r, char *b, size_t l, struct servent **res);\n"
        "int getprotobyname_r(const char *n, struct protoent *r, char *b, size_t l, struct protoent **res);\n"
        "int getprotobynumber_r(int proto, struct protoent *r, char *b, size_t l, struct protoent **res);\n"
        "int gethostbyname_r(const char *name, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);\n"
        "int gethostbyname2_r(const char *name, int af, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);\n"
        "int gethostbyaddr_r(const void *addr, socklen_t len, int type, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);\n"
        "extern long __timezone;\n"
        "extern long timezone;\n"
        "extern int daylight;\n"
        "extern int __daylight;\n"
        "extern char *tzname[2];\n"
        "extern char **__tzname;\n"
        "const char *gnu_get_libc_version(void);\n"
        "const char *gnu_get_libc_release(void);\n"
        "#ifndef WRDE_NOCMD\n#define WRDE_NOCMD 0\n"
        "typedef struct { size_t we_wordc; char **we_wordv; size_t we_offs; } wordexp_t;\n"
        "static inline int wordexp(const char *w, wordexp_t *p, int f) { (void)w; (void)p; (void)f; return -1; }\n"
        "static inline void wordfree(wordexp_t *p) { (void)p; }\n#endif\n"
        "#if !defined(__ANDROID_API__) || __ANDROID_API__ < 28\n"
        "#ifndef aligned_alloc\n"
        "static inline void* aligned_alloc(size_t a, size_t s) { void *p; return posix_memalign(&p, a, s) ? NULL : p; }\n"
        "#endif\n#endif\n"
        "#ifdef __cplusplus\n}\n#endif\n#endif\n",
        encoding="utf-8",
    )


def auto_patch_bionic_sources(src_dir: Path) -> None:
    """Automated Bionic polyfill and source patcher for Android builds."""
    if not src_dir or not src_dir.exists():
        return

    for p in src_dir.rglob("*"):
        if p.is_file() and p.suffix in (".h", ".cpp", ".c", ".cc", ".mm", ".hpp"):
            try:
                code_txt = p.read_text(encoding="utf-8", errors="ignore")
                new_code = code_txt
                if (
                    "#include <execinfo.h>" in new_code
                    or "#include <wordexp.h>" in new_code
                ):
                    new_code = re.sub(
                        r"#include\s*<execinfo\.h>",
                        "/* #include <execinfo.h> */",
                        new_code,
                    )
                    new_code = re.sub(
                        r"#include\s*<wordexp\.h>",
                        "/* #include <wordexp.h> */",
                        new_code,
                    )
                if "uc_mcontext.regs" in new_code:
                    new_code = new_code.replace(
                        "uc_mcontext.regs", "uc_mcontext.arm_regs"
                    )
                if new_code != code_txt:
                    p.write_text(new_code, encoding="utf-8")
            except Exception:
                pass

        if p.is_file() and (p.name == "OptionsJSCOnly.cmake" or p.suffix == ".cmake"):
            try:
                c_txt = p.read_text(encoding="utf-8", errors="ignore")
                if "find_package(ICU" in c_txt:
                    icu_stub = (
                        "add_library(ICU::uc UNKNOWN IMPORTED)\n"
                        "set_target_properties(ICU::uc PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicuuc.so INTERFACE_INCLUDE_DIRECTORIES /usr/include)\n"
                        "add_library(ICU::i18n UNKNOWN IMPORTED)\n"
                        "set_target_properties(ICU::i18n PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicui18n.so INTERFACE_INCLUDE_DIRECTORIES /usr/include)\n"
                        "add_library(ICU::data UNKNOWN IMPORTED)\n"
                        "set_target_properties(ICU::data PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicudata.so INTERFACE_INCLUDE_DIRECTORIES /usr/include)\n"
                        "set(ICU_FOUND TRUE)\n"
                        "set(ICU_INCLUDE_DIRS /usr/include)\n"
                        "set(ICU_LIBRARIES /usr/lib/aarch64-linux-gnu/libicuuc.so /usr/lib/aarch64-linux-gnu/libicui18n.so /usr/lib/aarch64-linux-gnu/libicudata.so)"
                    )
                    new_c = re.sub(
                        r"find_package\(ICU[^\)]*\)",
                        lambda _, stub=icu_stub: stub,
                        c_txt,
                    )
                    if new_c != c_txt:
                        p.write_text(new_c, encoding="utf-8")
            except Exception:
                pass


def verify_format_archives(output_dir: Path, pkg_name: str) -> None:
    elf_errors = audit_directory_elfs(output_dir)
    if elf_errors:
        print(f"⚠️ [{pkg_name}] ELF Linter Audit Warnings:")
        for err in elf_errors:
            print(f"  - {err}")
    for f in output_dir.glob(f"{pkg_name}*"):
        if f.name.endswith(".deb"):
            subprocess.run(["dpkg-deb", "-I", str(f)], check=True, capture_output=True)
        elif (
            f.name.endswith(".pkg.tar.zst")
            or f.name.endswith(".pkg.tar.gz")
            or f.name.endswith(".apk")
        ):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".whl"):
            subprocess.run(["unzip", "-t", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".tgz"):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)


def execute_compile(recipe, pkg_dir: Path, destdir: Path) -> Path:
    Path("/data/data/com.termux/files/usr/tmp").mkdir(parents=True, exist_ok=True)
    Path("/tmp").mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", "*"], check=False
    )

    if shutil.which("rustup"):
        subprocess.run(
            ["rustup", "default", "stable"], check=False, capture_output=True
        )
        subprocess.run(
            ["rustup", "component", "add", "rust-src"], check=False, capture_output=True
        )
        subprocess.run(
            ["rustup", "target", "add", "aarch64-linux-android"],
            check=False,
            capture_output=True,
        )
        subprocess.run(
            ["rustup", "target", "add", "aarch64-unknown-linux-gnu"],
            check=False,
            capture_output=True,
        )

    setup_bionic_compat()
    env = os.environ.copy()
    for k, v in DEFAULT_BIONIC_ENV.items():
        if k not in env:
            env[k] = v

    cpus = str(os.cpu_count() or 4)
    env["MAKEFLAGS"] = f"-j{cpus}"
    env["NINJA_JOBS"] = cpus
    env["CARGO_BUILD_JOBS"] = cpus
    env["GOMAXPROCS"] = cpus

    if shutil.which("sccache"):
        env["RUSTC_WRAPPER"] = "sccache"
        env["CMAKE_C_COMPILER_LAUNCHER"] = "sccache"
        env["CMAKE_CXX_COMPILER_LAUNCHER"] = "sccache"
        env["SCCACHE_DIR"] = "/home/builder/.cache/sccache"

    ndk_clang = resolve_ndk_tool("aarch64-linux-android24-clang")
    if ndk_clang and (Path(ndk_clang).exists() or shutil.which(ndk_clang)):
        env["NDK_CLANG"] = ndk_clang
        if "CC" not in env:
            env["CC"] = ndk_clang
        if "CXX" not in env:
            env["CXX"] = ndk_clang.replace("clang", "clang++")
        env["CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER"] = ndk_clang
        rustflags = (
            f"-C linker={ndk_clang} -C link-arg=-fuse-ld=lld -C link-arg=-static-libgcc"
            " -C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,--threads=4"
        )
        env["RUSTFLAGS"] = rustflags
        env["CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS"] = rustflags
        env["MATURIN_TARGET"] = "aarch64-linux-android"
        env["MATURIN_PEP517_ARGS"] = "--target aarch64-linux-android"

    if getattr(recipe, "cflags", None):
        env["CFLAGS"] = f"{env.get('CFLAGS', '')} {recipe.cflags}".strip()
    if getattr(recipe, "cxxflags", None):
        env["CXXFLAGS"] = f"{env.get('CXXFLAGS', '')} {recipe.cxxflags}".strip()
    if getattr(recipe, "ldflags", None):
        env["LDFLAGS"] = f"{env.get('LDFLAGS', '')} {recipe.ldflags}".strip()
    if getattr(recipe, "vars", None):
        env.update(recipe.vars)

    build_sys = getattr(recipe, "build_system", None)
    if build_sys:
        try:
            env.update(setup_build_environment(build_sys, recipe.arch))
        except Exception:
            pass

    print(f"[COMPILING] Package: {recipe.name} (Channel: {recipe.active_channel})")
    destdir.parent.mkdir(parents=True, exist_ok=True)
    if destdir.exists():
        shutil.rmtree(destdir)
    destdir.mkdir(parents=True, exist_ok=True)

    stage_dir = destdir / "stage"
    stage_dir.mkdir(parents=True, exist_ok=True)

    resolve_and_fetch_build_dependencies(getattr(recipe, "build_deps", []), destdir)

    work_dir = pkg_dir
    src_url = getattr(recipe, "source_url", None)
    if src_url:
        src_url_str = str(src_url).strip()
        archive_path = destdir / "source.tar.gz"
        src_extract_dir = destdir / "src"
        src_extract_dir.mkdir(parents=True, exist_ok=True)

        is_archive = any(
            ext in src_url_str
            for ext in [
                ".tar.gz",
                ".tgz",
                ".tar.xz",
                ".tar.bz2",
                ".zip",
                ".crate",
                ".whl",
            ]
        )
        if not is_archive and (
            src_url_str.endswith(".git") or "git" in src_url_str or "#" in src_url_str
        ):
            if "#" in src_url_str:
                parts = src_url_str.split("#")
                repo_url, ref = parts[0], parts[1]
                if len(ref) == 40 and all(c in "0123456789abcdefABCDEF" for c in ref):
                    subprocess.run(["git", "init", str(src_extract_dir)], check=True)
                    subprocess.run(
                        [
                            "git",
                            "-C",
                            str(src_extract_dir),
                            "remote",
                            "add",
                            "origin",
                            repo_url,
                        ],
                        check=True,
                    )
                    subprocess.run(
                        [
                            "git",
                            "-C",
                            str(src_extract_dir),
                            "fetch",
                            "--depth",
                            "1",
                            "origin",
                            ref,
                        ],
                        check=True,
                    )
                    subprocess.run(
                        ["git", "-C", str(src_extract_dir), "checkout", "FETCH_HEAD"],
                        check=True,
                    )
                else:
                    subprocess.run(
                        [
                            "git",
                            "clone",
                            "--depth",
                            "1",
                            "--branch",
                            ref,
                            repo_url,
                            str(src_extract_dir),
                        ],
                        check=True,
                    )
            else:
                subprocess.run(
                    ["git", "clone", "--depth", "1", src_url_str, str(src_extract_dir)],
                    check=True,
                )
            work_dir = src_extract_dir
        else:
            subprocess.run(
                [
                    "curl",
                    "-fsSL",
                    "-A",
                    "Mozilla/5.0",
                    "--retry",
                    "5",
                    src_url_str,
                    "-o",
                    str(archive_path),
                ],
                check=True,
            )
            subprocess.run(
                ["tar", "-xf", str(archive_path), "-C", str(src_extract_dir)],
                check=False,
            )
            extracted_items = [
                i for i in src_extract_dir.iterdir() if i.name != "source.tar.gz"
            ]
            work_dir = (
                extracted_items[0]
                if (len(extracted_items) == 1 and extracted_items[0].is_dir())
                else src_extract_dir
            )

    for p_folder in [
        pkg_dir / "patches",
        pkg_dir / f"patches@{recipe.active_channel}",
    ]:
        if p_folder.exists() and p_folder.is_dir():
            for patch_file in sorted(p_folder.glob("*.patch")):
                print(f"⚡ Applying patch: {patch_file.name}...")
                subprocess.run(
                    ["patch", "-p1", "-i", str(patch_file)],
                    cwd=work_dir,
                    check=True,
                )

    env["DESTDIR"] = str(stage_dir.resolve())
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", {})
    auto_patch_bionic_sources(work_dir)
    if Path("/tmp/webkit-src").exists():
        auto_patch_bionic_sources(Path("/tmp/webkit-src"))

    for phase_name in ("prepare", "configure", "make", "install"):
        cmd = phases.get(phase_name)
        if cmd:
            auto_patch_bionic_sources(work_dir)
            res = subprocess.run(cmd, shell=True, cwd=work_dir, env=env, check=False)
            if res.returncode != 0:
                raise RuntimeError(
                    f"{phase_name.capitalize()} phase failed for {recipe.name}"
                )

    files_dir = pkg_dir / "files"
    if files_dir.exists() and files_dir.is_dir():
        prefix_dest = stage_dir / "data" / "data" / "com.termux" / "files" / "usr"
        prefix_dest.mkdir(parents=True, exist_ok=True)
        shutil.copytree(files_dir, prefix_dest, dirs_exist_ok=True)

    sanitize_staging_elfs(stage_dir, prefix="/data/data/com.termux/files/usr")
    sanitize_shebangs(stage_dir)
    return stage_dir


def execute_pack(recipe, pkg_dir: Path, destdir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    stage_dir = destdir / "stage"

    subpkgs = process_subpackages(pkg_dir, stage_dir, recipe)

    targets = [(recipe, destdir)]
    for sub_rec, sub_st in subpkgs:
        sub_dest = destdir.parent / f"dest_{sub_rec.name}"
        sub_dest.mkdir(parents=True, exist_ok=True)
        (sub_dest / "stage").mkdir(parents=True, exist_ok=True)
        shutil.copytree(sub_st, sub_dest / "stage", dirs_exist_ok=True)
        targets.append((sub_rec, sub_dest))

    for rec, d_dir in targets:
        st_dir = d_dir / "stage"
        sanitize_staging_elfs(st_dir)
        sanitize_shebangs(st_dir)

        fmts = getattr(rec, "formats", ["apt", "pacman", "apk"])
        if "apt" in fmts:
            build_deb(
                rec,
                str(d_dir),
                str(output_dir),
                target_arch=rec.arch,
                pkg_src_dir=pkg_dir,
            )
        if "pacman" in fmts:
            build_pacman(rec, str(d_dir), str(output_dir), target_arch=rec.arch)
        if "apk" in fmts:
            build_alpine(rec, str(d_dir), str(output_dir), target_arch=rec.arch)
        if "pip" in fmts:
            build_pip(rec, str(d_dir), str(output_dir))
        if "npm" in node_fmts if (node_fmts := fmts) else []:
            build_npm(rec, str(d_dir), str(output_dir))

        verify_format_archives(output_dir, rec.name)

        meta = {
            "name": rec.name,
            "version": rec.version,
            "revision": rec.revision,
            "arch": rec.arch,
            "state_hash": getattr(rec, "state_hash", ""),
            "channel": getattr(rec, "active_channel", "latest"),
        }
        (output_dir / f"{rec.name}_metadata.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )


def execute_test(recipe, destdir: Path | None = None) -> None:
    phases = getattr(recipe, "phases", {})
    test_cmd = phases.get("test")
    runner = ProotTestRunner()
    cmd_to_run = test_cmd or f"{recipe.name} --version || {recipe.name} --help"
    runner.execute_test(recipe.name, cmd_to_run, destdir=destdir)
