#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <sys/resource.h>

#define CHUNK_SIZE (128ULL * 1024ULL * 1024ULL) // 128MB
#define PAGE_SIZE 4096ULL

static double get_time_sec(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return tv.tv_sec + tv.tv_usec * 1e-6;
}

int main(int argc, char **argv) {
    int total_gb = argc > 1 ? atoi(argv[1]) : 18;
    int num_chunks = (int)((total_gb * 1024ULL * 1024ULL * 1024ULL) / CHUNK_SIZE);
    if (num_chunks <= 0) num_chunks = 1;

    printf("Allocating and exercising %d GB in %d chunks of %llu MB...\n",
           total_gb, num_chunks, CHUNK_SIZE / (1024ULL * 1024ULL));

    char **chunks = (char **)malloc(sizeof(char *) * num_chunks);
    if (!chunks) {
        perror("malloc chunks list failed");
        return 1;
    }

    double t0 = get_time_sec();
    for (int i = 0; i < num_chunks; i++) {
        chunks[i] = (char *)malloc(CHUNK_SIZE);
        if (!chunks[i]) {
            fprintf(stderr, "Failed to allocate chunk %d\n", i);
            return 1;
        }
        for (size_t offset = 0; offset < CHUNK_SIZE; offset += PAGE_SIZE) {
            chunks[i][offset] = (char)((i + offset) & 0xFF);
        }
    }
    double t1 = get_time_sec();

    double t2 = get_time_sec();
    int errors = 0;
    for (int i = 0; i < num_chunks; i++) {
        for (size_t offset = 0; offset < CHUNK_SIZE; offset += PAGE_SIZE) {
            char expected = (char)((i + offset) & 0xFF);
            if (chunks[i][offset] != expected) {
                errors++;
            }
        }
    }
    double t3 = get_time_sec();

    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) == 0) {
        double user_sec = usage.ru_utime.tv_sec + usage.ru_utime.tv_usec * 1e-6;
        double sys_sec = usage.ru_stime.tv_sec + usage.ru_stime.tv_usec * 1e-6;
        printf("WRITE_TIME=%.3f\n", t1 - t0);
        printf("READ_TIME=%.3f\n", t3 - t2);
        printf("USER_CPU_SEC=%.3f\n", user_sec);
        printf("SYS_CPU_SEC=%.3f\n", sys_sec);
        printf("MAX_RSS_KB=%ld\n", usage.ru_maxrss);
        printf("PAGE_FAULTS_MAJ=%ld\n", usage.ru_majflt);
        printf("PAGE_FAULTS_MIN=%ld\n", usage.ru_minflt);
        printf("VERIFY_ERRORS=%d\n", errors);
    }

    for (int i = 0; i < num_chunks; i++) {
        free(chunks[i]);
    }
    free(chunks);
    return 0;
}
