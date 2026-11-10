package com.vinoteapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.k2fsa.sherpa.onnx.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.sin

/** Runs the same non-callback native entry point on the device, using synthetic audio. */
@RunWith(AndroidJUnit4::class)
class SpeakerNativeSmokeTest {
  @Test fun boundedWindowDoesNotCrash() {
    val assets = InstrumentationRegistry.getInstrumentation().targetContext.assets
    val config = OfflineSpeakerDiarizationConfig(
      segmentation = OfflineSpeakerSegmentationModelConfig(pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(model = "speaker/segmentation.onnx"), numThreads = 2, provider = "cpu"),
      embedding = SpeakerEmbeddingExtractorConfig(model = "speaker/embedding.onnx", numThreads = 2, provider = "cpu"),
      clustering = FastClusteringConfig(numClusters = -1, threshold = 0.5f),
      minDurationOn = 0.3f, minDurationOff = 0.5f,
    )
    val engine = OfflineSpeakerDiarization(assets, config)
    try {
      check(engine.sampleRate() == 16000)
      val samples = FloatArray(16000 * 12) { i -> (0.05 * sin(i * 2.0 * Math.PI * 220.0 / 16000)).toFloat() }
      engine.process(samples)
    } finally { engine.release() }
  }
}
