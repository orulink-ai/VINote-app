#ifndef VINOTE_SPEAKER_AUDIO_RANGE_H
#define VINOTE_SPEAKER_AUDIO_RANGE_H

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>

/* PCM allocation budget, matching Android's window + context allowance.
 * This bounds one invocation, not the recording length or an ASR model. */
#define VINOTE_SPEAKER_SAMPLE_RATE 16000U
#define VINOTE_SPEAKER_MAX_WINDOW_SAMPLES (130U * VINOTE_SPEAKER_SAMPLE_RATE)

typedef struct {
  uint32_t firstSample;
  uint32_t sampleCount;
  uint32_t sourceSamples;
} VINoteSpeakerRange;

static inline uint32_t VINoteSpeakerLE32(const unsigned char *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

/* Only the canonical WAV produced by MeetingAudio.toWav is accepted. */
static inline int VINoteSpeakerMakeRange(const unsigned char *h, uint64_t fileBytes,
                                        double start, double end, VINoteSpeakerRange *range) {
  if (!h || !range || fileBytes < 44 || memcmp(h, "RIFF", 4) || memcmp(h + 8, "WAVEfmt ", 8) ||
      memcmp(h + 36, "data", 4) || VINoteSpeakerLE32(h + 16) != 16 ||
      h[20] != 1 || h[21] || h[22] != 1 || h[23] ||
      VINoteSpeakerLE32(h + 24) != VINOTE_SPEAKER_SAMPLE_RATE ||
      VINoteSpeakerLE32(h + 28) != VINOTE_SPEAKER_SAMPLE_RATE * 2 ||
      h[32] != 2 || h[33] || h[34] != 16 || h[35]) return 0;
  const uint32_t bytes = VINoteSpeakerLE32(h + 40);
  if (!bytes || bytes % 2 || (uint64_t)bytes + 44 != fileBytes ||
      (uint64_t)VINoteSpeakerLE32(h + 4) + 8 != fileBytes) return 0;
  const uint32_t sourceSamples = bytes / 2;
  if (!isfinite(start) || !isfinite(end) || start < 0 || end <= start ||
      end > sourceSamples / (double)VINOTE_SPEAKER_SAMPLE_RATE + 1e-9) return 0;
  const double first = start * VINOTE_SPEAKER_SAMPLE_RATE;
  const double last = end * VINOTE_SPEAKER_SAMPLE_RATE;
  /* Avoid truncating a valid sample because of floating-point roundoff. */
  if (fabs(first - round(first)) > 1e-6 || fabs(last - round(last)) > 1e-6) return 0;
  const uint32_t firstSample = (uint32_t)round(first), lastSample = (uint32_t)round(last);
  if (lastSample > sourceSamples || lastSample <= firstSample ||
      lastSample - firstSample > VINOTE_SPEAKER_MAX_WINDOW_SAMPLES) return 0;
  range->firstSample = firstSample;
  range->sampleCount = lastSample - firstSample;
  range->sourceSamples = sourceSamples;
  return 1;
}

/* The caller allocates exactly range.sampleCount floats and always frees them.
 * Reading failure is never returned as partial/successful speech evidence. */
static inline int VINoteSpeakerReadRange(FILE *file, VINoteSpeakerRange range, float *samples) {
  if (!file || !samples || !range.sampleCount || range.sampleCount > VINOTE_SPEAKER_MAX_WINDOW_SAMPLES ||
      range.firstSample >= range.sourceSamples || range.sampleCount > range.sourceSamples - range.firstSample) return 0;
  const uint64_t byteOffset = 44ULL + (uint64_t)range.firstSample * 2;
#ifdef _WIN32
  if (_fseeki64(file, (int64_t)byteOffset, SEEK_SET)) return 0;
#else
  if (fseeko(file, (off_t)byteOffset, SEEK_SET)) return 0;
#endif
  unsigned char buffer[8192];
  uint32_t offset = 0;
  while (offset < range.sampleCount) {
    const uint32_t remaining = range.sampleCount - offset;
    const size_t count = remaining < sizeof(buffer) / 2 ? remaining : sizeof(buffer) / 2;
    if (fread(buffer, 2, count, file) != count) return 0;
    for (size_t i = 0; i < count; ++i) {
      const uint32_t bits = (uint32_t)buffer[i * 2] | (uint32_t)buffer[i * 2 + 1] << 8;
      const int32_t value = bits >= 32768 ? (int32_t)bits - 65536 : (int32_t)bits;
      samples[offset++] = value / 32768.0f;
    }
  }
  return 1;
}
#endif
