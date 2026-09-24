#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

// iOS grants only limited time. Checkpoints let the next foreground session resume.
@interface MeetingProcessing : NSObject <RCTBridgeModule>
@property (nonatomic, assign) UIBackgroundTaskIdentifier task;
@end

@implementation MeetingProcessing
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init {
  if ((self = [super init])) _task = UIBackgroundTaskInvalid;
  return self;
}
RCT_REMAP_METHOD(start, startWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.task == UIBackgroundTaskInvalid) {
      self.task = [UIApplication.sharedApplication beginBackgroundTaskWithName:@"VINote meeting processing" expirationHandler:^{
        UIBackgroundTaskIdentifier expired = self.task;
        self.task = UIBackgroundTaskInvalid;
        if (expired != UIBackgroundTaskInvalid) [UIApplication.sharedApplication endBackgroundTask:expired];
      }];
    }
    resolve(@(self.task != UIBackgroundTaskInvalid));
  });
}
RCT_REMAP_METHOD(stop, stopWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIBackgroundTaskIdentifier current = self.task;
    self.task = UIBackgroundTaskInvalid;
    if (current != UIBackgroundTaskInvalid) [UIApplication.sharedApplication endBackgroundTask:current];
    resolve(nil);
  });
}
@end
