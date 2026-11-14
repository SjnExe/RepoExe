#ifndef __GNUC_PREREQ
# if defined __GNUC__ && defined __GNUC_MINOR__
#  define __GNUC_PREREQ(maj, min) ((__GNUC__ << 16) + __GNUC_MINOR__ >= ((maj) << 16) + (min))
# else
#  define __GNUC_PREREQ(maj, min) 0
# endif
#endif

#ifndef __glibc_clang_prereq
# if defined __clang_major__ && defined __clang_minor__
#  define __glibc_clang_prereq(maj, min) ((__clang_major__ << 16) + __clang_minor__ >= ((maj) << 16) + (min))
# else
#  define __glibc_clang_prereq(maj, min) 0
# endif
#endif

#ifndef _BIONIC_STUB_H_
#define _BIONIC_STUB_H_

#ifndef __ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__
#define __ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__ 1
#endif

#if !defined(__ASSEMBLER__) && !defined(__ASSEMBLY__)

#define reallocarray __bionic_reallocarray_unused
#include <malloc.h>
#undef reallocarray

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

#if __has_include(<spawn.h>)
#include <spawn.h>
#else
#ifndef POSIX_SPAWN_RESETIDS
#define POSIX_SPAWN_RESETIDS 0x01
#define POSIX_SPAWN_SETPGROUP 0x02
#define POSIX_SPAWN_SETSIGDEF 0x04
#define POSIX_SPAWN_SETSIGMASK 0x08
#define POSIX_SPAWN_SETSCHEDPARAM 0x10
#define POSIX_SPAWN_SETSCHEDULER 0x20
#define POSIX_SPAWN_USEVFORK 0x40
#define POSIX_SPAWN_CLOEXEC_DEFAULT 0x2000
#endif

typedef struct __posix_spawn_file_actions* posix_spawn_file_actions_t;
typedef struct __posix_spawnattr* posix_spawnattr_t;

#ifdef __cplusplus
extern "C" {
#endif

int posix_spawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *file_actions, const posix_spawnattr_t *attrp, char *const argv[], char *const envp[]);
int posix_spawnp(pid_t *pid, const char *file, const posix_spawn_file_actions_t *file_actions, const posix_spawnattr_t *attrp, char *const argv[], char *const envp[]);
int posix_spawn_file_actions_init(posix_spawn_file_actions_t *file_actions);
int posix_spawn_file_actions_destroy(posix_spawn_file_actions_t *file_actions);
int posix_spawn_file_actions_addclose(posix_spawn_file_actions_t *file_actions, int fildes);
int posix_spawn_file_actions_adddup2(posix_spawn_file_actions_t *file_actions, int fildes, int newfildes);
int posix_spawn_file_actions_addopen(posix_spawn_file_actions_t *file_actions, int fildes, const char *path, int oflag, mode_t mode);
int posix_spawnattr_init(posix_spawnattr_t *attr);
int posix_spawnattr_destroy(posix_spawnattr_t *attr);
int posix_spawnattr_setflags(posix_spawnattr_t *attr, short flags);
int posix_spawnattr_getflags(const posix_spawnattr_t *attr, short *flags);
int posix_spawnattr_setpgroup(posix_spawnattr_t *attr, pid_t pgroup);
int posix_spawnattr_getpgroup(const posix_spawnattr_t *attr, pid_t *pgroup);
int posix_spawnattr_setsigmask(posix_spawnattr_t *attr, const sigset_t *sigmask);
int posix_spawnattr_getsigmask(const posix_spawnattr_t *attr, sigset_t *sigmask);
int posix_spawnattr_setsigdefault(posix_spawnattr_t *attr, const sigset_t *sigdefault);
int posix_spawnattr_getsigdefault(const posix_spawnattr_t *attr, sigset_t *sigdefault);

#ifdef __cplusplus
}
#endif

#endif

#ifdef __cplusplus
extern "C" {
#endif

extern long __timezone;
extern long timezone;
extern int daylight;
extern int __daylight;
extern char *tzname[2];
extern char *__tzname[2];

#ifndef _LIBINTL_H
#define _LIBINTL_H 1
#ifndef _LIBINTL_H_
#define _LIBINTL_H_ 1
#ifndef LIBINTL_H
#define LIBINTL_H 1
char *gettext(const char *msgid);
char *dgettext(const char *domainname, const char *msgid);
char *dcgettext(const char *domainname, const char *msgid, int category);
char *ngettext(const char *msgid1, const char *msgid2, unsigned long int n);
char *dngettext(const char *domainname, const char *msgid1, const char *msgid2, unsigned long int n);
char *dcngettext(const char *domainname, const char *msgid1, const char *msgid2, unsigned long int n, int category);
#endif
#endif
#endif
char *textdomain(const char *domainname);
char *bindtextdomain(const char *domainname, const char *dirname);
char *bind_textdomain_codeset(const char *domainname, const char *codeset);

void error(int status, int errnum, const char *fmt, ...);
void error_at_line(int status, int errnum, const char *fname, unsigned int lineno, const char *fmt, ...);
int fpurge(FILE *stream);
void __fpurge(FILE *stream);
int getdomainname(char *name, size_t len);
int setdomainname(const char *name, size_t len);

int *__errno_location(void);
int *__h_errno_location(void);
int _dl_find_object(void *address, void *result);
int dl_find_object(void *address, void *result);
int dladdr1(const void *addr, Dl_info *info, void **extra_info, int flags);
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
int pthread_getname_np(pthread_t thread, char *name, size_t len);

struct prop_info;
typedef void (*prop_read_callback_fn)(void* cookie, const char* name, const char* value, uint32_t serial);
void __system_property_read_callback(const struct prop_info* pi, prop_read_callback_fn callback, void* cookie);

struct AHardwareBuffer;
void AHardwareBuffer_acquire(struct AHardwareBuffer* buffer);
void AHardwareBuffer_release(struct AHardwareBuffer* buffer);

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
int futimesat(int dirfd, const char *path, const struct timeval times[2]);
int posix_fadvise(int fd, off_t offset, off_t len, int advice);
int posix_fadvise64(int fd, off_t offset, off_t len, int advice);
int posix_fallocate64(int fd, off_t offset, off_t len);

int getloadavg(double loadavg[], int nelem);
int malloc_trim(size_t pad);
void malloc_stats(void);
int mallopt(int param, int value);

char *canonicalize_file_name(const char *path);
char *get_current_dir_name(void);
int sync_file_range(int fd, off64_t offset, off64_t nbytes, unsigned int flags);

int stime(const time_t *t);
int res_init(void);
int __res_init(void);
unsigned int gnu_dev_major(unsigned long long dev);
unsigned int gnu_dev_minor(unsigned long long dev);
unsigned long long gnu_dev_makedev(unsigned int maj, unsigned int min);

void sincos(double x, double *s, double *c);
void __sincos(double x, double *s, double *c);
void sincosf(float x, float *s, float *c);
void __sincosf(float x, float *s, float *c);
int getentropy(void *buffer, size_t length);
ssize_t copy_file_range(int fd_in, off64_t *off_in, int fd_out, off64_t *off_out, size_t len, unsigned int flags);
int memfd_create(const char *name, unsigned int flags);

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

#ifdef __cplusplus
}
#endif

#endif /* !__ASSEMBLER__ && !__ASSEMBLY__ */

#endif /* _BIONIC_STUB_H_ */
