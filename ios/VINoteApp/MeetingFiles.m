#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <math.h>

@interface OriginalVideoController : AVPlayerViewController
@property(nonatomic,strong) AVPlayerItem *observedItem;
@property(nonatomic,assign) BOOL reportedFailure;
- (void)observeItem:(AVPlayerItem *)item;
@end
@implementation OriginalVideoController
- (void)observeItem:(AVPlayerItem *)item { self.observedItem=item; [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:NULL]; }
- (void)stopObserving { if (self.observedItem) { [self.observedItem removeObserver:self forKeyPath:@"status"]; self.observedItem=nil; } }
- (void)showFailure {
  if (self.reportedFailure || self.player.currentItem.status!=AVPlayerItemStatusFailed || !self.view.window) return;
  self.reportedFailure=YES; [self.player pause];
  UIAlertController *alert=[UIAlertController alertControllerWithTitle:@"无法播放原视频" message:@"此设备无法播放该视频格式，原文件仍可导出。" preferredStyle:UIAlertControllerStyleAlert];
  [alert addAction:[UIAlertAction actionWithTitle:@"返回" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) { [self.presentingViewController dismissViewControllerAnimated:YES completion:nil]; }]];
  [self presentViewController:alert animated:YES completion:nil];
}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if (object==self.observedItem && [keyPath isEqualToString:@"status"]) { dispatch_async(dispatch_get_main_queue(), ^{ [self showFailure]; }); return; }
  [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}
- (void)viewDidAppear:(BOOL)animated { [super viewDidAppear:animated]; [self showFailure]; }
- (void)viewDidDisappear:(BOOL)animated { [super viewDidDisappear:animated]; if (self.isBeingDismissed || !self.presentingViewController) { [self stopObserving]; [self.player pause]; self.player=nil; } }
- (void)dealloc { [self stopObserving]; [self.player pause]; }
@end

@interface MeetingFiles : NSObject <RCTBridgeModule, UIDocumentPickerDelegate>
@property(nonatomic,copy) RCTPromiseResolveBlock resolve;
@property(nonatomic,copy) RCTPromiseRejectBlock reject;
@property(nonatomic,assign) BOOL audioOnly;
@property(nonatomic,strong) AVPlayerViewController *preview;
@end
@implementation MeetingFiles
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (instancetype)init {
  if ((self=[super init])) [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(stopPreviewForBackground) name:UIApplicationDidEnterBackgroundNotification object:nil];
  return self;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; [self.preview.player pause]; }
- (void)stopPreviewForBackground { [self.preview.player pause]; self.preview.player=nil; [self.preview dismissViewControllerAnimated:NO completion:nil]; self.preview=nil; }
- (NSDictionary *)constantsToExport { return @{ @"originalMediaProtocol": @1 }; }
- (NSURL *)original:(NSString *)uri owner:(NSString *)owner {
  if (!owner.length || owner.length>200 || ![uri hasPrefix:@"file:///"]) return nil;
  NSURL *url=[NSURL fileURLWithPath:[uri substringFromIndex:7]];
  url=url.URLByResolvingSymlinksInPath;
  NSString *path=url.path;
  NSCharacterSet *allowed=[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"];
  NSString *segment=[owner stringByAddingPercentEncodingWithAllowedCharacters:allowed];
  NSString *documents=[NSURL fileURLWithPath:NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject].URLByResolvingSymlinksInPath.path;
  BOOL contained=NO;
  for (NSString *kind in @[@"files", @"recordings"]) {
    NSString *root=[documents stringByAppendingPathComponent:[NSString stringWithFormat:@"%@/accounts/%@",kind,segment]];
    if ([[NSURL fileURLWithPath:root].URLByResolvingSymlinksInPath.path isEqualToString:root] && [path.stringByDeletingLastPathComponent isEqualToString:root]) contained=YES;
  }
  NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:path error:nil];
  NSRegularExpression *filename=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9-]+\\.[a-z0-9]{1,8}$" options:0 error:nil];
  if ([filename numberOfMatchesInString:url.lastPathComponent options:0 range:NSMakeRange(0,url.lastPathComponent.length)]!=1) return nil;
  if (!contained || ![attributes[NSFileType] isEqualToString:NSFileTypeRegular] || ![attributes fileSize] || [attributes fileSize]>2ULL*1024*1024*1024) return nil;
  return url;
}
RCT_REMAP_METHOD(previewOriginal, previewOriginal:(NSString *)uri owner:(NSString *)owner seconds:(double)seconds resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *url=[self original:uri owner:owner]; UIViewController *presenter=RCTPresentedViewController();
  if (!url || !presenter || self.preview.presentingViewController || !isfinite(seconds) || seconds<0 || seconds>86400 || ![@[@"mp4",@"mov",@"mkv",@"webm",@"avi",@"m4v"] containsObject:url.pathExtension.lowercaseString]) { reject(@"ORIGINAL_PREVIEW",@"无法打开原视频，请核对格式或导出原件",nil); return; }
  OriginalVideoController *preview=[OriginalVideoController new];
  AVPlayerItem *item=[AVPlayerItem playerItemWithURL:url]; [preview observeItem:item]; preview.player=[AVPlayer playerWithPlayerItem:item];
  self.preview=preview; preview.showsPlaybackControls=YES;
  [preview.player seekToTime:CMTimeMakeWithSeconds(seconds,600)];
  [presenter presentViewController:preview animated:YES completion:^{ [preview.player play]; resolve(@YES); }];
}
RCT_EXPORT_METHOD(closeOriginalPreview) {
  [self.preview.player pause]; self.preview.player=nil;
  [self.preview dismissViewControllerAnimated:YES completion:nil]; self.preview=nil;
}
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
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller { if (self.resolve) self.resolve(NSNull.null); self.resolve=nil; self.reject=nil; }
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  if (!self.resolve) return;
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
