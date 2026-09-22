import React, { useEffect, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { PrimaryButton } from '../components/PrimaryButton'
import { colors, styles } from '../design-system/theme'
import { listenRecording, startRecording, stopRecording } from '../features/recording/recordingService'
import { createNote, uploadMeetingRecording, waitForTask } from '../lib/notes'

export function RecordScreen({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => recording ? listenRecording(ms => setSeconds(Math.floor(ms / 1000))) : undefined, [recording])
  const toggle = async () => {
    if (recording) {
      setBusy(true)
      try {
        const uri = await stopRecording(); setRecording(false)
        const title = `会议纪要 ${new Date().toLocaleString('zh-CN')}`
        const task = await uploadMeetingRecording(uri, title)
        const status = await waitForTask(task.task_id)
        if (!status.result) throw new Error('服务端没有返回会议纪要')
        await createNote({ title: status.result.title || title, content: status.result.markdown, task_id: task.task_id })
        Alert.alert('已完成', '会议纪要已经生成并保存。', [{ text: '查看纪要', onPress: onDone }])
      } catch (error) { Alert.alert('处理失败', error instanceof Error ? error.message : '请稍后重试') }
      finally { setBusy(false) }
    } else {
      try { await startRecording(); setSeconds(0); setRecording(true) } catch (error) { Alert.alert('无法录音', error instanceof Error ? error.message : '请检查麦克风权限') }
    }
  }
  return <View style={styles.screen}><View style={[styles.content, styles.recordContent]}><Text style={styles.title}>录制会议</Text><Text style={styles.subtitle}>结束后会自动上传云端生成会议纪要，处理期间请保持网络连接。</Text><View style={[styles.card, styles.recordCard]}><Text style={[styles.timer, { color: recording ? colors.danger : colors.ink }]}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Text><Text style={styles.subtitle}>{recording ? '正在录音' : busy ? '正在生成会议纪要' : '准备就绪'}</Text></View><PrimaryButton title={recording ? '结束并生成纪要' : busy ? '处理中…' : '开始录音'} loading={busy} disabled={busy} onPress={toggle} /><PrimaryButton secondary title="返回首页" disabled={recording || busy} onPress={onBack} /></View></View>
}
