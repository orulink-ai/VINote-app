Pod::Spec.new do |s|
  s.name = 'VINoteSpeakers'
  s.version = '1.12.35'
  s.summary = 'VINote on-device speaker timeline'
  s.homepage = 'https://github.com/k2-fsa/sherpa-onnx'
  s.license = { :type => 'Apache-2.0' }
  s.author = 'VINote'
  s.source = { :git => 'https://github.com/k2-fsa/sherpa-onnx.git', :tag => 'v1.12.35' }
  s.platform = :ios, '15.1'
  s.source_files = 'MeetingSpeakers.m', 'SpeakerAudioRange.h'
  s.vendored_frameworks = 'sherpa-runtime/sherpa-onnx.xcframework', 'sherpa-runtime/onnxruntime.xcframework'
  s.resource_bundles = { 'VINoteSpeakerModels' => ['speaker-models/*.onnx'] }
  s.frameworks = 'Foundation', 'Accelerate', 'CoreML'
  s.libraries = 'c++'
  s.dependency 'React-Core'
end
