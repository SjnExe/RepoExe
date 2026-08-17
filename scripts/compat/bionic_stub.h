#ifndef _BIONIC_STUB_H
#define _BIONIC_STUB_H
#define _GNU_SOURCE 1
#include <sys/cdefs.h>
#include <android/api-level.h>
#include <sys/types.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <sys/time.h>
#include <sys/stat.h>
#include <pthread.h>
#include <signal.h>
#include <netdb.h>
#include <dlfcn.h>
#include <wchar.h>
#include <wctype.h>
#include <locale.h>
#include <langinfo.h>
#include <time.h>
#include <poll.h>

#undef __timezone
#undef timezone
#undef daylight
#undef __daylight
#undef tzname
#undef __tzname
#undef bcopy
#undef bzero
#undef bcmp

#ifdef __cplusplus
extern "C" {
#endif

extern long __timezone;
extern long timezone;
extern int daylight;
extern int __daylight;
extern char *tzname[2];
extern char **__tzname;

char *gettext(const char *msgid);
char *dgettext(const char *domainname, const char *msgid);
char *dcgettext(const char *domainname, const char *msgid, int category);
char *ngettext(const char *msgid1, const char *msgid2, unsigned long int n);
char *dngettext(const char *domainname, const char *msgid1, const char *msgid2, unsigned long int n);
char *dcngettext(const char *domainname, const char *msgid1, const char *msgid2, unsigned long int n, int category);
char *textdomain(const char *domainname);
char *bindtextdomain(const char *domainname, const char *dirname);
char *bind_textdomain_codeset(const char *domainname, const char *codeset);

void error(int status, int errnum, const char *fmt, ...);
void error_at_line(int status, int errnum, const char *fname, unsigned int lineno, const char *fmt, ...);
int fpurge(FILE *stream);
void __fpurge(FILE *stream);
int getdomainname(char *name, size_t len);
int setdomainname(const char *name, size_t len);

void *__memcpy_chk(void *dest, const void *src, size_t len, size_t destlen);
void *__memmove_chk(void *dest, const void *src, size_t len, size_t destlen);
void *__memset_chk(void *dest, int c, size_t len, size_t destlen);
char *__strcpy_chk(char *dest, const char *src, size_t destlen);
char *__strncpy_chk(char *dest, const char *src, size_t len, size_t destlen);
char *__strcat_chk(char *dest, const char *src, size_t destlen);
char *__strncat_chk(char *dest, const char *src, size_t len, size_t destlen);
void *__mempcpy_chk(void *dest, const void *src, size_t len, size_t buflen);
char *__stpcpy_chk(char *dest, const char *src, size_t buflen);
char *__stpncpy_chk(char *dest, const char *src, size_t n, size_t buflen);

wchar_t *__wmemset_chk(wchar_t *s, wchar_t c, size_t n, size_t buflen);
wchar_t *__wmemcpy_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen);
wchar_t *__wmemmove_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen);
wchar_t *__wmempcpy_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen);
wchar_t *__wcscpy_chk(wchar_t *dest, const wchar_t *src, size_t buflen);
wchar_t *__wcsncpy_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen);
wchar_t *__wcscat_chk(wchar_t *dest, const wchar_t *src, size_t buflen);
wchar_t *__wcsncat_chk(wchar_t *dest, const wchar_t *src, size_t n, size_t buflen);

size_t __mbsrtowcs_chk(wchar_t *dst, const char **src, size_t len, mbstate_t *ps, size_t buflen);
size_t __mbsnrtowcs_chk(wchar_t *dst, const char **src, size_t nmc, size_t len, mbstate_t *ps, size_t buflen);
size_t __wcsrtombs_chk(char *dst, const wchar_t **src, size_t len, mbstate_t *ps, size_t buflen);
size_t __wcsnrtombs_chk(char *dst, const wchar_t **src, size_t nwc, size_t len, mbstate_t *ps, size_t buflen);
size_t __mbstowcs_chk(wchar_t *dst, const char *src, size_t len, size_t buflen);
size_t __wcstombs_chk(char *dst, const wchar_t *src, size_t len, size_t buflen);
size_t __wcrtomb_chk(char *s, wchar_t wc, mbstate_t *ps, size_t buflen);
int __wctomb_chk(char *s, wchar_t wchar, size_t buflen);

int __swprintf_chk(wchar_t *s, size_t n, int flag, size_t slen, const wchar_t *format, ...);
int __vswprintf_chk(wchar_t *s, size_t n, int flag, size_t slen, const wchar_t *format, va_list ap);
int __fwprintf_chk(FILE *stream, int flag, const wchar_t *format, ...);
int __vfwprintf_chk(FILE *stream, int flag, const wchar_t *format, va_list ap);
int __wprintf_chk(int flag, const wchar_t *format, ...);
int __vwprintf_chk(int flag, const wchar_t *format, va_list ap);
wchar_t *__fgetws_chk(wchar_t *s, size_t buflen, int n, FILE *stream);
wchar_t *__fgetws_unlocked_chk(wchar_t *s, size_t buflen, int n, FILE *stream);

int __snprintf_chk(char *s, size_t maxlen, int flag, size_t slen, const char *format, ...);
int __vsnprintf_chk(char *s, size_t maxlen, int flag, size_t slen, const char *format, va_list ap);
int __sprintf_chk(char *s, int flag, size_t slen, const char *format, ...);
int __vsprintf_chk(char *s, int flag, size_t slen, const char *format, va_list ap);
int __printf_chk(int flag, const char *format, ...);
int __vprintf_chk(int flag, const char *format, va_list ap);
int __fprintf_chk(FILE *stream, int flag, const char *format, ...);
int __vfprintf_chk(FILE *stream, int flag, const char *format, va_list ap);
int __dprintf_chk(int fd, int flag, const char *format, ...);
int __vdprintf_chk(int fd, int flag, const char *format, va_list ap);
int __asprintf_chk(char **result_ptr, int flag, const char *format, ...);
int __vasprintf_chk(char **result_ptr, int flag, const char *format, va_list ap);

char *__fgets_chk(char *s, size_t buflen, int n, FILE *stream);
char *__fgets_unlocked_chk(char *s, size_t buflen, int n, FILE *stream);
size_t __fread_chk(void *ptr, size_t buflen, size_t size, size_t n, FILE *stream);
size_t __fread_unlocked_chk(void *ptr, size_t buflen, size_t size, size_t n, FILE *stream);
ssize_t __read_chk(int fd, void *buf, size_t nbytes, size_t buflen);
ssize_t __pread_chk(int fd, void *buf, size_t nbytes, off_t offset, size_t buflen);
ssize_t __pread64_chk(int fd, void *buf, size_t nbytes, off64_t offset, size_t buflen);
ssize_t __readlink_chk(const char *path, char *buf, size_t len, size_t buflen);
ssize_t __readlinkat_chk(int dirfd, const char *path, char *buf, size_t len, size_t buflen);
char *__getcwd_chk(char *buf, size_t len, size_t buflen);
char *__realpath_chk(const char *path, char *resolved_path, size_t buflen);
ssize_t __recv_chk(int fd, void *buf, size_t len, size_t buflen, int flags);
ssize_t __recvfrom_chk(int fd, void *buf, size_t len, size_t buflen, int flags, struct sockaddr *src_addr, socklen_t *addrlen);
int __poll_chk(struct pollfd *fds, nfds_t nfds, int timeout, size_t fds_size);
int __ppoll_chk(struct pollfd *fds, nfds_t nfds, const struct timespec *tmo_p, const sigset_t *sigmask, size_t fds_size);
long int __fdelt_chk(long int d);

int *__get_h_errno(void);
int *__h_errno(void);
int __cxa_at_quick_exit(void (*func)(void), void *dso_handle);
int at_quick_exit(void (*func)(void));
void quick_exit(int status);
void __wrap_quick_exit(int status);
int _dl_find_object(void *address, void *result);
int dl_find_object(void *address, void *result);
int dladdr1(const void *addr, Dl_info *info, void **extra_info, int flags);
void *__libc_dlopen_mode(const char *name, int mode);
void *__libc_dlsym(void *handle, const char *name);
int __libc_dlclose(void *handle);
int __register_atfork(void (*prepare)(void), void (*parent)(void), void (*child)(void), void *dso_handle);
int __libc_current_sigrtmin(void);
int __libc_current_sigrtmax(void);

int timespec_get(struct timespec *ts, int base);
int timespec_getres(struct timespec *ts, int base);
locale_t __newlocale(int category_mask, const char *locale, locale_t base);
void __freelocale(locale_t loc);
locale_t __uselocale(locale_t loc);
locale_t __duplocale(locale_t loc);
char *__nl_langinfo_l(nl_item item, locale_t loc);
int __toupper_l(int c, locale_t loc);
int __tolower_l(int c, locale_t loc);
wint_t __towupper_l(wint_t wc, locale_t loc);
wint_t __towlower_l(wint_t wc, locale_t loc);
double __strtod_l(const char *nptr, char **endptr, locale_t loc);
float __strtof_l(const char *nptr, char **endptr, locale_t loc);
long double __strtold_l(const char *nptr, char **endptr, locale_t loc);
long __strtol_l(const char *nptr, char **endptr, int base, locale_t loc);
unsigned long __strtoul_l(const char *nptr, char **endptr, int base, locale_t loc);
long long __strtoll_l(const char *nptr, char **endptr, int base, locale_t loc);
unsigned long long __strtoull_l(const char *nptr, char **endptr, int base, locale_t loc);
size_t __strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc);
size_t __wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc);
int __strcoll_l(const char *s1, const char *s2, locale_t loc);
size_t __strxfrm_l(char *dest, const char *src, size_t n, locale_t loc);
int __wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);
size_t __wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc);
int __strcasecmp_l(const char *s1, const char *s2, locale_t loc);
int __strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc);
int __wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);
int __wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc);
int __iswalpha_l(wint_t wc, locale_t loc);
int __iswdigit_l(wint_t wc, locale_t loc);
int __iswspace_l(wint_t wc, locale_t loc);
int __iswctype_l(wint_t wc, wctype_t desc, locale_t loc);
wctype_t __wctype_l(const char *name, locale_t loc);

int pthread_getname_np(pthread_t __pthread, char* __buf, size_t __buf_size);
int pthread_cond_clockwait(pthread_cond_t* __cond, pthread_mutex_t* __mutex, clockid_t __clock_id, const struct timespec* __abstime);
int pthread_setcancelstate(int state, int *oldstate);
int pthread_setcanceltype(int type, int *oldtype);
int pthread_cancel(pthread_t thread);
void pthread_testcancel(void);
int pthread_yield(void);
int pthread_getattr_np(pthread_t th, pthread_attr_t *attr);

int sigtimedwait(const sigset_t *set, siginfo_t *info, const struct timespec *timeout);
int sigwaitinfo(const sigset_t *set, siginfo_t *info);
int signalfd(int fd, const sigset_t *mask, int flags);

int __xstat(int ver, const char *path, struct stat *stat_buf);
int __fxstat(int ver, int fd, struct stat *stat_buf);
int __lxstat(int ver, const char *path, struct stat *stat_buf);
int __fxstatat(int ver, int dirfd, const char *path, struct stat *stat_buf, int flags);
int __xstat64(int ver, const char *path, void *stat_buf);
int __fxstat64(int ver, int fd, void *stat_buf);
int __lxstat64(int ver, const char *path, void *stat_buf);
int __fxstatat64(int ver, int dirfd, const char *path, void *stat_buf, int flags);
int __xmknod(int ver, const char *path, mode_t mode, dev_t *dev);
int __xmknodat(int ver, int dirfd, const char *path, mode_t mode, dev_t *dev);

int lchmod(const char *path, mode_t mode);
int futimes(int fd, const struct timeval tv[2]);
int lutimes(const char *path, const struct timeval tv[2]);
int posix_fadvise(int fd, off_t offset, off_t len, int advice);
int posix_fadvise64(int fd, off64_t offset, off64_t len, int advice);
int posix_fallocate(int fd, off_t offset, off_t len);
int posix_fallocate64(int fd, off64_t offset, off64_t len);

int getloadavg(double loadavg[], int nelem);
int malloc_trim(size_t pad);
void malloc_stats(void);
int mallopt(int param, int value);
char *secure_getenv(const char *name);
char *__secure_getenv(const char *name);
int clearenv(void);

char *strchrnul(const char *s, int c);
char *__strchrnul(const char *s, int c);
void *rawmemchr(const void *s, int c);
void *__rawmemchr(const void *s, int c);
void *mempcpy(void *dest, const void *src, size_t n);
void *__mempcpy(void *dest, const void *src, size_t n);
wchar_t *wmempcpy(wchar_t *dest, const wchar_t *src, size_t n);
char *canonicalize_file_name(const char *path);
char *get_current_dir_name(void);
int sync_file_range(int fd, off64_t offset, off64_t nbytes, unsigned int flags);

char *__strdup(const char *s);
char *__strndup(const char *s, size_t n);
char *__strtok_r(char *s, const char *d, char **p);
char *__stpcpy(char *d, const char *s);
char *__stpncpy(char *d, const char *s, size_t n);
int __asprintf(char **strp, const char *fmt, ...);
int __vasprintf(char **strp, const char *fmt, va_list ap);
int __dprintf(int fd, const char *fmt, ...);
int __vdprintf(int fd, const char *fmt, va_list ap);
int __snprintf(char *s, size_t n, const char *fmt, ...);
int __vsnprintf(char *s, size_t n, const char *fmt, va_list ap);
int __sprintf(char *s, const char *fmt, ...);
int __vsprintf(char *s, const char *fmt, va_list ap);

time_t timelocal(struct tm *tm);
int stime(const time_t *t);
int res_init(void);
int __res_init(void);
unsigned int gnu_dev_major(unsigned long long dev);
unsigned int gnu_dev_minor(unsigned long long dev);
unsigned long long gnu_dev_makedev(unsigned int maj, unsigned int min);

int strcoll_l(const char *s1, const char *s2, locale_t loc);
size_t strxfrm_l(char *dest, const char *src, size_t n, locale_t loc);
int wcscoll_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);
size_t wcsxfrm_l(wchar_t *dest, const wchar_t *src, size_t n, locale_t loc);
int strcasecmp_l(const char *s1, const char *s2, locale_t loc);
int strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc);
int wcscasecmp_l(const wchar_t *s1, const wchar_t *s2, locale_t loc);
int wcsncasecmp_l(const wchar_t *s1, const wchar_t *s2, size_t n, locale_t loc);
wint_t towupper_l(wint_t wc, locale_t loc);
wint_t towlower_l(wint_t wc, locale_t loc);
int iswalpha_l(wint_t wc, locale_t loc);
int iswdigit_l(wint_t wc, locale_t loc);
int iswspace_l(wint_t wc, locale_t loc);
int iswctype_l(wint_t wc, wctype_t desc, locale_t loc);
wctype_t wctype_l(const char *name, locale_t loc);
long strtol_l(const char *nptr, char **endptr, int base, locale_t loc);
unsigned long strtoul_l(const char *nptr, char **endptr, int base, locale_t loc);
long long strtoll_l(const char *nptr, char **endptr, int base, locale_t loc);
unsigned long long strtoull_l(const char *nptr, char **endptr, int base, locale_t loc);
size_t strftime_l(char *s, size_t max, const char *fmt, const struct tm *tm, locale_t loc);
size_t wcsftime_l(wchar_t *s, size_t max, const wchar_t *fmt, const struct tm *tm, locale_t loc);

double __exp_finite(double x);
double __exp2_finite(double x);
double __log_finite(double x);
double __log2_finite(double x);
double __log10_finite(double x);
double __pow_finite(double x, double y);
float __expf_finite(float x);
float __exp2f_finite(float x);
float __logf_finite(float x);
float __log2f_finite(float x);
float __log10f_finite(float x);
float __powf_finite(float x, float y);
void sincos(double x, double *s, double *c);
void __sincos(double x, double *s, double *c);
void sincosf(float x, float *s, float *c);
void __sincosf(float x, float *s, float *c);
int sched_getcpu(void);
void *reallocarray(void *ptr, size_t nmemb, size_t size);

const unsigned short **__ctype_b_loc(void);
const int32_t **__ctype_tolower_loc(void);
const int32_t **__ctype_toupper_loc(void);
size_t __ctype_get_mb_cur_max(void);

int getservbyname_r(const char *n, const char *p, struct servent *r, char *b, size_t l, struct servent **res);
int getservbyport_r(int port, const char *p, struct servent *r, char *b, size_t l, struct servent **res);
int getprotobyname_r(const char *n, struct protoent *r, char *b, size_t l, struct protoent **res);
int getprotobynumber_r(int proto, struct protoent *r, char *b, size_t l, struct protoent **res);
int gethostbyname_r(const char *name, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);
int gethostbyname2_r(const char *name, int af, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);
int gethostbyaddr_r(const void *addr, socklen_t len, int type, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);

const char *gnu_get_libc_version(void);
const char *gnu_get_libc_release(void);

#ifndef WRDE_NOCMD
#define WRDE_NOCMD 0
typedef struct { size_t we_wordc; char **we_wordv; size_t we_offs; } wordexp_t;
static inline int wordexp(const char *w, wordexp_t *p, int f) { (void)w; (void)p; (void)f; return -1; }
static inline void wordfree(wordexp_t *p) { (void)p; }
#endif

#if !defined(__ANDROID_API__) || __ANDROID_API__ < 28
#ifndef aligned_alloc
static inline void* aligned_alloc(size_t a, size_t s) { void *p; return posix_memalign(&p, a, s) ? NULL : p; }
#endif
#endif

#ifdef __cplusplus
}
#endif
#endif
