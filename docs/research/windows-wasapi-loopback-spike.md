# Windows WASAPI loopback 技术 spike

## 结论

本轮不加入未经 Windows 实机验证的 Rust crate。Windows 首版应实现“默认渲染终结点的系统混音 loopback”，而不是进程级过滤：

1. 通过 `IMMDeviceEnumerator::GetDefaultAudioEndpoint(eRender, eConsole)` 获取默认渲染设备。
2. 以 `AUDCLNT_SHAREMODE_SHARED` 和 `AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK` 初始化 `IAudioClient`。
3. 通过 `IAudioCaptureClient` 拉取音频包，处理 silent/discontinuity flags，转为 mono 16 kHz 后送入现有 `TimedAudioMixer`。
4. 默认设备变化时结束当前 adapter 并返回可恢复错误，由统一 session 重新启动；不在 native adapter 内静默切换设备。

微软文档确认 loopback 只适用于 shared mode，且 Windows 10 1703 起支持 event-driven loopback；它捕获渲染终结点的系统混音，不要求硬件提供 “Stereo Mix” 设备：

- <https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording>
- <https://learn.microsoft.com/en-us/windows/win32/coreaudio/audclnt-streamflags-xxx-constants>

进程级 include/exclude loopback 使用 `ActivateAudioInterfaceAsync` 和 `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`，最低系统版本与兼容面不同，不属于本轮“捕获全部系统输出”的目标：

- <https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-audioclient_activation_type>
- <https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/>

## 必须先通过的 Windows 矩阵

| 场景 | 验证点 |
|---|---|
| 内置扬声器 | 连续 10 分钟无断流，静音段不制造噪声 |
| USB/蓝牙耳机 | 默认设备切换后返回可恢复状态，可手动重启 |
| Zoom / Teams / Meet | 对端声音进入 `audio-chunk`，麦克风可同时混合 |
| 独占模式播放 | 明确报告不支持；loopback 不能覆盖 exclusive-mode stream |
| DRM/受保护内容 | 不承诺捕获，遵循系统和驱动限制 |
| Windows 10 22H2 / Windows 11 | x86_64 release 构建、停止、重复启动和睡眠恢复 |

完成矩阵后再选择 `windows` crate 直接绑定或经过审核的 WASAPI wrapper，并把 adapter 接入现有 `start_audio_capture` / `stop_audio_capture` seam。当前非 macOS 原生层如实返回系统音频不可用，前端自动降级到麦克风。
