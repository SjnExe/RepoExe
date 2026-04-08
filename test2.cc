#include <stdint.h>
struct z_stream_mock {
    const uint8_t* next_in;
};
void test() {
    z_stream_mock zstream;
    const uint8_t* buf = 0;
#define ZLIB_CONST 1
#ifdef ZLIB_CONST
    zstream.next_in = buf;
#else
    zstream.next_in = reinterpret_cast<uint8_t*>(const_cast<uint8_t*>(buf));
#endif
}
