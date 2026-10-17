#include "../SpeakerAudioRange.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void put32(unsigned char *p, uint32_t n) {
  for (int i = 0; i < 4; ++i) p[i] = (unsigned char)(n >> (i * 8));
}
static void header(unsigned char *h, uint32_t samples) {
  memset(h, 0, 44);
  memcpy(h, "RIFF", 4); put32(h + 4, samples * 2 + 36);
  memcpy(h + 8, "WAVEfmt ", 8); put32(h + 16, 16);
  h[20] = 1; h[22] = 1; put32(h + 24, 16000); put32(h + 28, 32000);
  h[32] = 2; h[34] = 16; memcpy(h + 36, "data", 4); put32(h + 40, samples * 2);
}
int main(void) {
  unsigned char h[44]; VINoteSpeakerRange r;
  const uint32_t source = 250 * 16000;
  header(h, source);
  assert(VINoteSpeakerMakeRange(h, 44ULL + source * 2, 115, 245, &r));
  assert(r.firstSample == 115 * 16000 && r.sampleCount == 130 * 16000);
  assert(VINoteSpeakerMakeRange(h, 44ULL + source * 2, 235, 250, &r));
  assert(r.firstSample == 235 * 16000 && r.sampleCount == 15 * 16000);
  /* The bound is per request, not a total-recording or 120-second model limit. */
  assert(VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0, 121, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0, 250, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, -1, 1, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 1, 1, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 10, 9, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, NAN, 1, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0, INFINITY, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 249, 251, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0, 130 + 1.0 / 16000, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0.1 / 16000, 1, &r));
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2 - 1, 0, 1, &r));
  h[22] = 2;
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0, 1, &r));
  header(h, source); h[36] = 'x';
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0, 1, &r));
  header(h, source); h[4] = 0;
  assert(!VINoteSpeakerMakeRange(h, 44ULL + source * 2, 0, 1, &r));
  header(h, 1376 * 16000 + 8777);
  assert(VINoteSpeakerMakeRange(h, 44ULL + (1376 * 16000 + 8777) * 2, 1375, 1376 + 8777.0 / 16000, &r));
  assert(r.sampleCount == 16000 + 8777);

  /* Read actual offset PCM through the same function as MeetingSpeakers.m. */
  FILE *f = tmpfile(); assert(f);
  header(h, 4); assert(fwrite(h, 1, 44, f) == 44);
  const unsigned char pcm[] = {0, 0, 0, 128, 255, 127, 0, 64};
  assert(fwrite(pcm, 1, sizeof(pcm), f) == sizeof(pcm)); fflush(f);
  assert(VINoteSpeakerMakeRange(h, 52, 1.0 / 16000, 4.0 / 16000, &r));
  float values[4] = {0};
  assert(VINoteSpeakerReadRange(f, r, values));
  assert(values[0] == -1 && values[1] == 32767.0f / 32768 && values[2] == .5f);
  r.sampleCount = 4;
  assert(!VINoteSpeakerReadRange(f, r, values)); /* range past the declared source */
  fclose(f);
  f = tmpfile(); assert(f);
  assert(fwrite(h, 1, 44, f) == 44);
  assert(fwrite(pcm, 1, 4, f) == 4); fflush(f); /* header promises more PCM */
  assert(VINoteSpeakerMakeRange(h, 52, 1.0 / 16000, 4.0 / 16000, &r));
  assert(!VINoteSpeakerReadRange(f, r, values));
  fclose(f);

  /* Exercise multiple bounded disk reads, seeking a nonzero window offset. */
  f = tmpfile(); assert(f);
  header(h, 10001); assert(fwrite(h, 1, 44, f) == 44);
  for (unsigned int i = 0; i < 10001; ++i) {
    unsigned char value[2] = {(unsigned char)i, (unsigned char)(i >> 8)};
    assert(fwrite(value, 1, 2, f) == 2);
  }
  fflush(f);
  assert(VINoteSpeakerMakeRange(h, 20046, 7.0 / 16000, 10001.0 / 16000, &r));
  float *many = malloc(r.sampleCount * sizeof(float)); assert(many);
  assert(VINoteSpeakerReadRange(f, r, many));
  for (unsigned int i = 0; i < r.sampleCount; ++i) assert(many[i] == (i + 7) / 32768.0f);
  free(many); fclose(f);
  puts("SpeakerAudioRange: range bounds, malformed input, exact offsets and short reads passed");
  return 0;
}
