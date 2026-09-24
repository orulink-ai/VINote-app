#import <React/RCTBridgeModule.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AVFoundation/AVFoundation.h>
#include <math.h>
#include <limits.h>
#include <string.h>

// 原音频只读，流式解码为双端统一的 16k 单声道 PCM WAV。
@interface MeetingAudio : NSObject <RCTBridgeModule>
@end
@implementation MeetingAudio
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0); }
RCT_REMAP_METHOD(audioInfo, audioInfo:(NSString *)uri resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *url=[NSURL URLWithString:uri];
  NSString *documents=NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject;
  if (!url.isFileURL || ![url.URLByResolvingSymlinksInPath.path hasPrefix:[documents.stringByResolvingSymlinksInPath stringByAppendingString:@"/"]]) { reject(@"AUDIO_PATH",@"录音路径无效",nil); return; }
  NSError *error=nil; AVAudioFile *file=[[AVAudioFile alloc] initForReading:url error:&error];
  if (!file || file.length<=0 || file.processingFormat.sampleRate<=0) { reject(@"AUDIO_INFO",@"音频未完成或没有有效时长，请检查录音",error); return; }
  resolve(@(file.length/file.processingFormat.sampleRate));
}
static NSURL *cacheURL(void) { return [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"asr-%@.wav", NSUUID.UUID.UUIDString]]]; }
static NSData *header(uint32_t size) {
  uint8_t bytes[44] = {0};
  memcpy(bytes, "RIFF", 4); memcpy(bytes+8, "WAVEfmt ", 8); memcpy(bytes+36, "data", 4);
  uint32_t n = CFSwapInt32HostToLittle(size+36); memcpy(bytes+4, &n, 4);
  n = CFSwapInt32HostToLittle(16); memcpy(bytes+16, &n, 4); bytes[20]=1; bytes[22]=1;
  n=CFSwapInt32HostToLittle(16000); memcpy(bytes+24,&n,4); n=CFSwapInt32HostToLittle(32000); memcpy(bytes+28,&n,4);
  bytes[32]=2; bytes[34]=16; n=CFSwapInt32HostToLittle(size); memcpy(bytes+40,&n,4);
  return [NSData dataWithBytes:bytes length:44];
}
static BOOL validCache(NSURL *url, unsigned long long *size) {
  if (![url.URLByResolvingSymlinksInPath.path.stringByDeletingLastPathComponent isEqualToString:[NSURL fileURLWithPath:NSTemporaryDirectory()].URLByResolvingSymlinksInPath.path] || ![url.lastPathComponent hasPrefix:@"asr-"]) return NO;
  *size = [[NSFileManager.defaultManager attributesOfItemAtPath:url.path error:nil] fileSize];
  if (*size <= 44 || *size > INT32_MAX) return NO;
  NSFileHandle *file = [NSFileHandle fileHandleForReadingAtPath:url.path];
  NSData *data = [file readDataOfLength:44]; [file closeFile];
  return [data isEqualToData:header((uint32_t)(*size-44))];
}
RCT_REMAP_METHOD(toWav, toWav:(NSString *)uri resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *source=[NSURL URLWithString:uri];
  NSString *documents=NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  if (!source.isFileURL || ![source.URLByResolvingSymlinksInPath.path hasPrefix:[documents.stringByResolvingSymlinksInPath stringByAppendingString:@"/"]]) { reject(@"AUDIO_PATH", @"录音路径无效", nil); return; }
  ExtAudioFileRef input=NULL; NSURL *output=cacheURL(); NSFileHandle *file=nil;
  @try {
    if (ExtAudioFileOpenURL((__bridge CFURLRef)source, &input)!=noErr) @throw [NSException exceptionWithName:@"audio" reason:@"无法解码所选音频" userInfo:nil];
    AudioStreamBasicDescription format={0}; format.mSampleRate=16000; format.mFormatID=kAudioFormatLinearPCM;
    format.mFormatFlags=kAudioFormatFlagIsSignedInteger|kAudioFormatFlagIsPacked; format.mBytesPerPacket=2; format.mFramesPerPacket=1; format.mBytesPerFrame=2; format.mChannelsPerFrame=1; format.mBitsPerChannel=16;
    if (ExtAudioFileSetProperty(input,kExtAudioFileProperty_ClientDataFormat,sizeof(format),&format)!=noErr) @throw [NSException exceptionWithName:@"audio" reason:@"不支持的音频格式" userInfo:nil];
    [NSFileManager.defaultManager createFileAtPath:output.path contents:header(0) attributes:nil]; file=[NSFileHandle fileHandleForWritingAtPath:output.path];
    if (!file) @throw [NSException exceptionWithName:@"audio" reason:@"无法创建音频缓存，请检查存储空间" userInfo:nil];
    [file seekToEndOfFile]; uint8_t bytes[65536]; uint32_t total=0;
    while (YES) {
      UInt32 frames=32768; AudioBufferList buffer={0}; buffer.mNumberBuffers=1; buffer.mBuffers[0].mNumberChannels=1; buffer.mBuffers[0].mDataByteSize=sizeof(bytes); buffer.mBuffers[0].mData=bytes;
      if (ExtAudioFileRead(input,&frames,&buffer)!=noErr) @throw [NSException exceptionWithName:@"audio" reason:@"音频解码失败" userInfo:nil];
      if (!frames) break;
      if (total > INT32_MAX-65536) @throw [NSException exceptionWithName:@"audio" reason:@"音频过大" userInfo:nil];
      [file writeData:[NSData dataWithBytes:bytes length:frames*2]]; total+=frames*2;
    }
    if (!total) @throw [NSException exceptionWithName:@"audio" reason:@"音频为空" userInfo:nil];
    [file seekToFileOffset:0]; [file writeData:header(total)]; [file closeFile]; file=nil; resolve(output.absoluteString);
  } @catch (NSException *e) { [file closeFile]; [NSFileManager.defaultManager removeItemAtURL:output error:nil]; reject(@"AUDIO_CONVERSION",e.reason,nil); }
  @finally { if (input) ExtAudioFileDispose(input); }
}
RCT_REMAP_METHOD(wavInfo, wavInfo:(NSString *)uri resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  unsigned long long size=0; if (!validCache([NSURL URLWithString:uri],&size)) { reject(@"AUDIO_INFO",@"音频缓存无效",nil); return; } resolve(@((size-44)/32000.0));
}
RCT_REMAP_METHOD(wavChunk, wavChunk:(NSString *)uri index:(double)index resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  unsigned long long size=0; NSURL *source=[NSURL URLWithString:uri];
  if (!isfinite(index) || index<0 || floor(index)!=index || !validCache(source,&size) || index >= ceil((size-44)/3840000.0)) { reject(@"AUDIO_CHUNK",@"分段无效",nil); return; }
  NSURL *output=cacheURL(); NSFileHandle *file=[NSFileHandle fileHandleForReadingAtPath:source.path];
  @try {
    unsigned long long offset=(unsigned long long)index*3840000; NSUInteger count=(NSUInteger)MIN(3840000ULL,size-44-offset);
    [file seekToFileOffset:44+offset]; NSData *part=[file readDataOfLength:count];
    NSMutableData *data=[header((uint32_t)count) mutableCopy]; [data appendData:part];
    NSError *error=nil;
    if (part.length!=count || ![data writeToURL:output options:NSDataWritingAtomic error:&error]) { reject(@"AUDIO_CHUNK",@"音频分段写入失败",error); return; }
    resolve(output.absoluteString);
  } @catch (NSException *e) { reject(@"AUDIO_CHUNK",e.reason,nil); } @finally { [file closeFile]; }
}
@end
