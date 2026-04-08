#include <stdint.h>
struct z_stream_mock {
    const uint8_t* next_in;
};
void test() {
    z_stream_mock zstream;
    const uint8_t* buf = 0;
    zstream.next_in = reinterpret_cast<decltype(zstream.next_in)>(const_cast<uint8_t*>(buf));
}
