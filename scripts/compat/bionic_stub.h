#ifndef _BIONIC_STUB_H_
#define _BIONIC_STUB_H_

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <poll.h>
#include <locale.h>
#include <wchar.h>
#include <wctype.h>
#include <netdb.h>
#include <dlfcn.h>
#include <pthread.h>
#include <signal.h>
#include <math.h>

#if __has_include(<langinfo.h>)
#include <langinfo.h>
#else
typedef int nl_item;
#endif

extern long __timezone;
extern long timezone;
extern int daylight;
extern int __daylight;
extern char *tzname[2];
extern char *__tzname[2];

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

int pthread_setcancelstate(int state, int *oldstate);
int pthread_setcanceltype(int type, int *oldtype);
int pthread_cancel(pthread_t thread);
void pthread_testcancel(void);
int pthread_yield(void);

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

char *canonicalize_file_name(const char *path);
char *get_current_dir_name(void);
int sync_file_range(int fd, off64_t offset, off64_t nbytes, unsigned int flags);

time_t timelocal(struct tm *tm);
int stime(const time_t *t);
int res_init(void);
int __res_init(void);
unsigned int gnu_dev_major(unsigned long long dev);
unsigned int gnu_dev_minor(unsigned long long dev);
unsigned long long gnu_dev_makedev(unsigned int maj, unsigned int min);

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

int getservbyname_r(const char *n, const char *p, struct servent *r, char *b, size_t l, struct servent **res);
int getservbyport_r(int port, const char *p, struct servent *r, char *b, size_t l, struct servent **res);
int getprotobyname_r(const char *n, struct protoent *r, char *b, size_t l, struct protoent **res);
int getprotobynumber_r(int proto, struct protoent *r, char *b, size_t l, struct protoent **res);
int gethostbyname_r(const char *name, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);
int gethostbyname2_r(const char *name, int af, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);
int gethostbyaddr_r(const void *addr, socklen_t len, int type, struct hostent *ret, char *buf, size_t buflen, struct hostent **result, int *h_errnop);

const char *gnu_get_libc_version(void);
const char *gnu_get_libc_release(void);
int __cxa_thread_atexit_impl(void (*func)(void *), void *obj, void *dso_symbol);

#ifndef WRDE_NOCMD
#define WRDE_NOCMD 0
typedef struct { size_t we_wordc; char **we_wordv; size_t we_offs; } wordexp_t;
static inline int wordexp(const char *w, wordexp_t *p, int f) { (void)w; (void)p; (void)f; return -1; }
static inline void wordfree(wordexp_t *p) { (void)p; }
#endif

#if !defined(__ANDROID_API__) || __ANDROID_API__ < 28
#ifndef aligned_alloc
static inline void* aligned_alloc(size_t a, size_t s) {
    void *p = NULL;
    return posix_memalign(&p, a, s) == 0 ? p : NULL;
}
#endif
#endif

#ifdef __cplusplus
}
#endif

#endif /* _BIONIC_STUB_H_ */
