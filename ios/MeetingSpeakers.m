#import <React/RCTEventEmitter.h>
#import "sherpa-runtime/sherpa-onnx.xcframework/Headers/sherpa-onnx/c-api/c-api.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

@interface MeetingSpeakers : RCTEventEmitter
@end

typedef struct { __unsafe_unretained MeetingSpeakers *module; __unsafe_unretained NSString *jobId; int last; } SpeakerProgress;
static int32_t progressCallback(int32_t done, int32_t total, void *context) {
  SpeakerProgress *progress = context;
  int percent = (int)(done * 100.0 / MAX(total, 1)) / 5 * 5;
  if (percent != progress->last) {
    progress->last = percent;
    [progress->module sendEventWithName:@"meetingSpeakerProgress" body:@{@"jobId": progress->jobId, @"progress": @(percent)}];
  }
  return 0;
}

@implementation MeetingSpeakers
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (NSArray<NSString *> *)supportedEvents { return @[@"meetingSpeakerProgress"]; }
- (dispatch_queue_t)methodQueue {
  static dispatch_queue_t worker;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ worker = dispatch_queue_create("app.vinote.speakers", DISPATCH_QUEUE_SERIAL); });
  return worker;
}
RCT_REMAP_METHOD(embeddings, embeddings:(NSString *)uri windows:(NSArray *)windows jobId:(NSString *)jobId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  const SherpaOnnxSpeakerEmbeddingExtractor *extractor = NULL;
  FILE *file = NULL;
  @try {
    NSURL *url = [NSURL URLWithString:uri];
    NSString *path = url.URLByResolvingSymlinksInPath.path;
    if (!url.isFileURL || ![path.stringByDeletingLastPathComponent isEqualToString:NSTemporaryDirectory().stringByResolvingSymlinksInPath] || ![path.lastPathComponent hasPrefix:@"asr-"] || ![path.pathExtension isEqualToString:@"wav"] || windows.count < 1 || windows.count > 128) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"声音特征缓存或批次无效" userInfo:nil];
    file = fopen(path.fileSystemRepresentation, "rb");
    uint8_t header[44];
    if (!file || fread(header, 1, 44, file) != 44 || memcmp(header, "RIFF", 4) || memcmp(header + 8, "WAVEfmt ", 8) || memcmp(header + 36, "data", 4)) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"声音特征音频格式无效" userInfo:nil];
    uint16_t format, channels, bits; uint32_t rate, bytes;
    memcpy(&format, header + 20, 2); memcpy(&channels, header + 22, 2); memcpy(&rate, header + 24, 4); memcpy(&bits, header + 34, 2); memcpy(&bytes, header + 40, 4);
    if (format != 1 || channels != 1 || rate != 16000 || bits != 16 || bytes != [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil].fileSize - 44) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"声音特征音频格式无效" userInfo:nil];
    NSString *bundlePath = [NSBundle.mainBundle pathForResource:@"VINoteSpeakerModels" ofType:@"bundle"];
    NSString *model = [[NSBundle bundleWithPath:bundlePath] pathForResource:@"embedding" ofType:@"onnx"];
    if (!model) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"安装包缺少声音特征模型" userInfo:nil];
    SherpaOnnxSpeakerEmbeddingExtractorConfig config = {0};
    config.model = model.UTF8String; config.num_threads = 2; config.provider = "cpu";
    extractor = SherpaOnnxCreateSpeakerEmbeddingExtractor(&config);
    if (!extractor) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"声音特征模型初始化失败" userInfo:nil];
    NSMutableArray *features = [NSMutableArray arrayWithCapacity:windows.count];
    for (NSUInteger i = 0; i < windows.count; i++) {
      NSDictionary *window = windows[i];
      double start = [window[@"start"] doubleValue], end = [window[@"end"] doubleValue];
      if (!isfinite(start) || !isfinite(end) || start < 0 || end <= start || end - start > 8.001 || end * 16000 > bytes / 2.0 + 1) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"声音特征区间超出录音" userInfo:nil];
      int32_t count = (end - start) * 16000;
      int16_t *pcm = malloc((size_t)count * sizeof(int16_t));
      float *samples = malloc((size_t)count * sizeof(float));
      @try {
      if (!pcm || !samples) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"本机内存不足，请稍后重试" userInfo:nil];
      if (fseek(file, 44 + (int64_t)(start * 16000) * 2, SEEK_SET) || fread(pcm, 2, count, file) != count) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"声音特征区间读取失败" userInfo:nil];
      for (int32_t j = 0; j < count; j++) samples[j] = pcm[j] / 32768.0f;
      const SherpaOnnxOnlineStream *stream = SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractor);
      if (!stream) @throw [NSException exceptionWithName:@"SpeakerFeatures" reason:@"声音特征流初始化失败" userInfo:nil];
      @try {
        SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples, count);
        SherpaOnnxOnlineStreamInputFinished(stream);
        const float *embedding = SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractor, stream) ? SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractor, stream) : NULL;
        if (embedding) {
          @try {
            NSMutableArray *vector = [NSMutableArray array];
            for (int32_t j = 0; j < SherpaOnnxSpeakerEmbeddingExtractorDim(extractor); j++) [vector addObject:@(embedding[j])];
            [features addObject:vector];
          } @finally { SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(embedding); }
        } else [features addObject:NSNull.null];
      } @finally { SherpaOnnxDestroyOnlineStream(stream); }
      [self sendEventWithName:@"meetingSpeakerProgress" body:@{@"jobId": jobId, @"phase": @"refining", @"progress": @((i + 1) * 100 / windows.count)}];
      } @finally { free(pcm); free(samples); }
    }
    resolve(features);
  } @catch (NSException *error) { reject(@"SPEAKER_FEATURES", error.reason, nil); }
  @finally { if (file) fclose(file); if (extractor) SherpaOnnxDestroySpeakerEmbeddingExtractor(extractor); }
}
RCT_REMAP_METHOD(analyze, analyze:(NSString *)uri jobId:(NSString *)jobId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  const SherpaOnnxOfflineSpeakerDiarization *engine = NULL;
  const SherpaOnnxOfflineSpeakerDiarizationResult *result = NULL;
  const SherpaOnnxOfflineSpeakerDiarizationSegment *segments = NULL;
  float *samples = NULL;
  FILE *file = NULL;
  @try {
    NSURL *url = [NSURL URLWithString:uri];
    NSString *path = url.URLByResolvingSymlinksInPath.path;
    NSString *cache = NSTemporaryDirectory().stringByResolvingSymlinksInPath;
    if (!url.isFileURL || ![path.stringByDeletingLastPathComponent isEqualToString:cache] || ![path.lastPathComponent hasPrefix:@"asr-"] || ![path.pathExtension isEqualToString:@"wav"]) @throw [NSException exceptionWithName:@"SpeakerAudio" reason:@"说话人分析缓存路径无效" userInfo:nil];
    file = fopen(path.fileSystemRepresentation, "rb");
    uint8_t header[44];
    if (!file || fread(header, 1, 44, file) != 44 || memcmp(header, "RIFF", 4) || memcmp(header + 8, "WAVEfmt ", 8) || memcmp(header + 36, "data", 4)) @throw [NSException exceptionWithName:@"SpeakerAudio" reason:@"音频缓存不完整" userInfo:nil];
    uint16_t format, channels, bits; uint32_t rate, bytes;
    memcpy(&format, header + 20, 2); memcpy(&channels, header + 22, 2); memcpy(&rate, header + 24, 4); memcpy(&bits, header + 34, 2); memcpy(&bytes, header + 40, 4);
    int64_t size = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil].fileSize;
    if (format != 1 || channels != 1 || rate != 16000 || bits != 16 || bytes != size - 44 || !bytes || bytes % 2 || bytes / 2 > 16000 * 7200) @throw [NSException exceptionWithName:@"SpeakerAudio" reason:@"本机分析需要完整的 16k 单声道音频，支持两小时内录音" userInfo:nil];
    int32_t count = bytes / 2;
    samples = malloc((size_t)count * sizeof(float));
    if (!samples) @throw [NSException exceptionWithName:@"SpeakerMemory" reason:@"本机内存不足，请稍后重试" userInfo:nil];
    int16_t buffer[32768]; int32_t offset = 0;
    while (offset < count) {
      size_t n = MIN(32768, count - offset);
      if (fread(buffer, sizeof(int16_t), n, file) != n) @throw [NSException exceptionWithName:@"SpeakerAudio" reason:@"音频缓存读取失败" userInfo:nil];
      for (size_t i = 0; i < n; i++) samples[offset++] = buffer[i] / 32768.0f;
    }
    NSString *bundlePath = [NSBundle.mainBundle pathForResource:@"VINoteSpeakerModels" ofType:@"bundle"];
    NSBundle *bundle = bundlePath ? [NSBundle bundleWithPath:bundlePath] : nil;
    NSString *segmentation = [bundle pathForResource:@"segmentation" ofType:@"onnx"];
    NSString *embedding = [bundle pathForResource:@"embedding" ofType:@"onnx"];
    if (!segmentation || !embedding) @throw [NSException exceptionWithName:@"SpeakerModels" reason:@"安装包缺少说话人模型，请更新 App" userInfo:nil];
    SherpaOnnxOfflineSpeakerDiarizationConfig config = {0};
    config.segmentation.pyannote.model = segmentation.UTF8String;
    config.segmentation.num_threads = 2; config.segmentation.provider = "cpu";
    config.embedding.model = embedding.UTF8String; config.embedding.num_threads = 2; config.embedding.provider = "cpu";
    config.clustering.num_clusters = -1; config.clustering.threshold = 0.5;
    config.min_duration_on = 0.3; config.min_duration_off = 0.5;
    engine = SherpaOnnxCreateOfflineSpeakerDiarization(&config);
    if (!engine || SherpaOnnxOfflineSpeakerDiarizationGetSampleRate(engine) != 16000) @throw [NSException exceptionWithName:@"SpeakerModels" reason:@"说话人模型初始化失败" userInfo:nil];
    SpeakerProgress progress = {self, jobId, -1};
    result = SherpaOnnxOfflineSpeakerDiarizationProcessWithCallback(engine, samples, count, progressCallback, &progress);
    if (!result) @throw [NSException exceptionWithName:@"SpeakerAnalysis" reason:@"说话人分析失败，请重试" userInfo:nil];
    int32_t total = SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(result);
    segments = SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(result);
    if (!segments || total < 1) @throw [NSException exceptionWithName:@"SpeakerAnalysis" reason:@"未检测到有效发言，请检查原声" userInfo:nil];
    NSMutableArray *turns = [NSMutableArray arrayWithCapacity:total];
    for (int32_t i = 0; i < total; i++) {
      if (!isfinite(segments[i].start) || !isfinite(segments[i].end) || segments[i].start < 0 || segments[i].end <= segments[i].start) @throw [NSException exceptionWithName:@"SpeakerAnalysis" reason:@"说话人时间轴无效" userInfo:nil];
      [turns addObject:@{@"start": @(segments[i].start), @"end": @(MIN(segments[i].end, count / 16000.0)), @"speaker": @(segments[i].speaker)}];
    }
    resolve(@{@"provider": @"sherpa-onnx", @"duration": @(count / 16000.0), @"segments": turns});
  } @catch (NSException *error) { reject(@"SPEAKER_ANALYSIS", error.reason, nil); }
  @finally {
    if (file) fclose(file);
    if (segments) SherpaOnnxOfflineSpeakerDiarizationDestroySegment(segments);
    if (result) SherpaOnnxOfflineSpeakerDiarizationDestroyResult(result);
    if (engine) SherpaOnnxDestroyOfflineSpeakerDiarization(engine);
    free(samples);
  }
}
@end
