#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <AVFoundation/AVFoundation.h>

@interface MeetingFiles : NSObject <RCTBridgeModule, UIDocumentPickerDelegate>
@property(nonatomic,copy) RCTPromiseResolveBlock resolve;
@property(nonatomic,copy) RCTPromiseRejectBlock reject;
@property(nonatomic,assign) BOOL audioOnly;
@end
@implementation MeetingFiles
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
RCT_REMAP_METHOD(pickAudio, pickAudio:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self pick:YES resolver:resolve rejecter:reject];
}
RCT_REMAP_METHOD(pickFile, pickFile:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self pick:NO resolver:resolve rejecter:reject];
}
- (void)pick:(BOOL)audioOnly resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject {
  if (self.resolve) { reject(@"AUDIO_PICKER",@"请选择或取消当前文件",nil); return; }
  UIViewController *presenter=RCTPresentedViewController();
  if (!presenter) { reject(@"AUDIO_PICKER",@"请返回前台后重试",nil); return; }
  self.resolve=resolve; self.reject=reject;
  self.audioOnly=audioOnly;
  UIDocumentPickerViewController *picker=[[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[audioOnly ? UTTypeAudio : UTTypeItem] asCopy:YES];
  picker.delegate=self; picker.allowsMultipleSelection=NO; [presenter presentViewController:picker animated:YES completion:nil];
}
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller { self.resolve(NSNull.null); self.resolve=nil; self.reject=nil; }
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  RCTPromiseResolveBlock resolve=self.resolve; RCTPromiseRejectBlock reject=self.reject; self.resolve=nil; self.reject=nil;
  NSURL *url=urls.firstObject; if (!url) { resolve(NSNull.null); return; }
  BOOL validateAudio=self.audioOnly;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
    BOOL access=[url startAccessingSecurityScopedResource];
    NSURL *target=[NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"import-%@.%@",NSUUID.UUID.UUIDString,url.pathExtension]]];
    NSError *error=nil;
    BOOL copied=[NSFileManager.defaultManager copyItemAtURL:url toURL:target error:&error];
    if (access) [url stopAccessingSecurityScopedResource];
    if (copied) {
      NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:target.path error:&error];
      unsigned long long size=[attributes fileSize]; copied=size>0 && size<=2ULL*1024*1024*1024;
    }
    if (copied && validateAudio) { AVAudioFile *audio=[[AVAudioFile alloc] initForReading:target error:&error]; copied=audio && audio.length>0; }
    if (!copied) { [NSFileManager.defaultManager removeItemAtURL:target error:nil]; reject(@"AUDIO_IMPORT",@"无法读取音频，请检查格式和文件完整性",error); return; }
    resolve(@{@"uri":target.absoluteString,@"name":url.lastPathComponent});
  });
}
RCT_REMAP_METHOD(releaseAudio, releaseAudio:(NSString *)uri resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *url=[NSURL URLWithString:uri];
  if (![url.URLByResolvingSymlinksInPath.path.stringByDeletingLastPathComponent isEqualToString:[NSURL fileURLWithPath:NSTemporaryDirectory()].URLByResolvingSymlinksInPath.path] || ![url.lastPathComponent hasPrefix:@"import-"]) { reject(@"AUDIO_PATH",@"缓存路径无效",nil); return; }
  [NSFileManager.defaultManager removeItemAtURL:url error:nil]; resolve(nil);
}
@end
