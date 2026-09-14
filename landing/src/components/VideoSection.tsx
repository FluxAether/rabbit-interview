import { useEffect, useRef, useState } from 'react'
import { Maximize2, Pause, Play, RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react'
import type { Copy } from '../locales/content'

interface VideoSectionProps {
  t: Copy
}

export default function VideoSection({ t }: VideoSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(74.16)
  const [isMuted, setIsMuted] = useState(false)
  const [activeChapterIndex, setActiveChapterIndex] = useState(0)

  const chapters = t.videoShowcase.chapters

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      // Determine active chapter
      let currentIdx = 0
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (video.currentTime >= chapters[i].time - 0.5) {
          currentIdx = i
          break
        }
      }
      setActiveChapterIndex(currentIdx)
    }

    const onLoadedMetadata = () => {
      if (video.duration && !Number.isNaN(video.duration)) {
        setDuration(video.duration)
      }
    }

    const onPlay = () => {
      setIsPlaying(true)
      setHasStarted(true)
    }

    const onPause = () => {
      setIsPlaying(false)
      setIsBuffering(false)
    }

    const onEnded = () => {
      setIsPlaying(false)
      setIsBuffering(false)
    }

    const onWaiting = () => {
      setIsBuffering(true)
    }

    const onPlaying = () => {
      setIsBuffering(false)
      setIsPlaying(true)
      setHasStarted(true)
    }

    const onCanPlay = () => {
      setIsBuffering(false)
    }

    const onError = () => {
      setIsBuffering(false)
      setIsPlaying(false)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('error', onError)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('error', onError)
    }
  }, [chapters])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      video.pause()
    } else {
      if (video.readyState < 3) {
        setIsBuffering(true)
      }
      video.play().catch(() => {
        setIsBuffering(false)
      })
    }
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
  }

  const toggleFullscreen = () => {
    const container = containerRef.current || videoRef.current
    if (!container) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {
        videoRef.current?.requestFullscreen().catch(() => {})
      })
    } else if (videoRef.current && (videoRef.current as any).webkitEnterFullscreen) {
      (videoRef.current as any).webkitEnterFullscreen()
    }
  }

  const seekToChapter = (time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
    if (!isPlaying) {
      if (video.readyState < 3) {
        setIsBuffering(true)
      }
      video.play().catch(() => {
        setIsBuffering(false)
      })
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const target = Number(e.target.value)
    video.currentTime = target
    setCurrentTime(target)
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <section id="video" className="relative scroll-mt-16 border-t border-white/5 bg-gradient-to-b from-white/[0.01] to-transparent py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-mute">
            <Sparkles className="h-3.5 w-3.5 text-sky-400" />
            <span>{t.videoShowcase.badge}</span>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
            {t.videoShowcase.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-mute sm:text-base">
            {t.videoShowcase.subtitle}
          </p>
        </div>

        <div className="relative mx-auto mt-12 max-w-5xl">
          {/* Subtle atmospheric backdrop glow */}
          <div className="pointer-events-none absolute -inset-4 rounded-[36px] bg-gradient-to-r from-sky-500/10 via-emerald-500/10 to-purple-500/10 opacity-70 blur-2xl" />

          {/* Video Container Card */}
          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-[22px] border border-white/15 bg-[#0e0e12] shadow-2xl shadow-black/80"
          >
            {/* Aspect Ratio Box: Video Display Area (Subtitles completely unblocked) */}
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <video
                ref={videoRef}
                src="/videos/oncue-promo.mp4"
                poster="/videos/poster.jpg"
                playsInline
                preload="metadata"
                className="h-full w-full object-cover cursor-pointer"
                onClick={togglePlay}
              />

              {/* Center Play / Buffering Overlay */}
              {(isBuffering || !isPlaying) && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center bg-black/35 backdrop-blur-[1px] transition-all hover:bg-black/25 cursor-pointer"
                  onClick={togglePlay}
                >
                  {isBuffering ? (
                    <div className="pointer-events-none relative flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full border border-white/15 bg-black/60 backdrop-blur-md shadow-2xl shadow-black/80">
                      <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full border-2 border-white/15 border-t-sky-400 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={t.videoShowcase.play}
                        className="group relative flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full border border-white/25 bg-black/45 backdrop-blur-md text-white shadow-2xl shadow-black/80 transition-all duration-200 hover:scale-105 hover:border-sky-400/50 hover:bg-black/65 hover:shadow-sky-500/20 active:scale-95"
                      >
                        <Play className="ml-1 h-7 w-7 sm:h-8 sm:w-8 fill-white text-white transition-transform duration-200 group-hover:scale-105 group-hover:fill-sky-300 group-hover:text-sky-300" />
                      </button>
                      {!hasStarted && (
                        <div className="mt-4 flex items-center gap-2 rounded-full border border-white/15 bg-black/60 px-3.5 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md shadow-lg shadow-black/50">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{t.videoShowcase.play} · 1:14</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Dedicated Player HUD Toolbar (Docked cleanly below video so subtitles are never blocked) */}
            <div className="border-t border-white/10 bg-[#0c0c10] p-4 sm:px-5 sm:py-3.5">
              {/* Progress Slider with Chapter Markers */}
              <div className="relative flex items-center py-1">
                {/* Visual Fill Track */}
                <div
                  className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-l-lg bg-sky-400"
                  style={{ width: `${Math.min(100, Math.max(0, (currentTime / (duration || 74)) * 100))}%` }}
                />
                {/* Chapter Tick Marks */}
                {chapters.map((ch) =>
                  ch.time > 0 ? (
                    <div
                      key={ch.tag}
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-2.5 w-0.5 -ml-px rounded-full bg-white/40"
                      style={{ left: `${(ch.time / (duration || 74)) * 100}%` }}
                      title={ch.title}
                    />
                  ) : null
                )}
                <input
                  type="range"
                  min={0}
                  max={duration || 74}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Progress"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/15 accent-sky-400 focus:outline-none hover:bg-white/25 transition-colors"
                />
              </div>

              {/* Action Toolbar */}
              <div className="mt-2.5 flex items-center justify-between gap-3 text-xs text-white">
                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors active:scale-95"
                    aria-label={isPlaying ? t.videoShowcase.pause : t.videoShowcase.play}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4 fill-white" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => seekToChapter(0)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors active:scale-95"
                    title={t.videoShowcase.replay}
                    aria-label={t.videoShowcase.replay}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={toggleMute}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors active:scale-95"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
                  </button>

                  <span className="font-mono text-[11px] text-mute pl-1">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                  {chapters[activeChapterIndex] && (
                    <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-400/[0.08] px-2.5 py-0.5 font-mono text-[11px] font-medium text-sky-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                      <span>{chapters[activeChapterIndex].tag} {chapters[activeChapterIndex].title}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors active:scale-95"
                    title={t.videoShowcase.fullscreen}
                    aria-label={t.videoShowcase.fullscreen}
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive Chapter Grid */}
            <div className="border-t border-white/10 bg-[#121217] p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between text-xs text-mute">
                <span className="font-medium tracking-wide text-ink">{t.videoShowcase.chapterPrompt}</span>
                <span className="font-mono text-[11px] text-mute/80">{activeChapterIndex + 1} / {chapters.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {chapters.map((ch, idx) => {
                  const isActive = activeChapterIndex === idx
                  return (
                    <button
                      key={ch.tag}
                      type="button"
                      onClick={() => seekToChapter(ch.time)}
                      className={`group relative flex flex-col justify-between rounded-xl border p-3 text-left transition-all ${
                        isActive
                          ? 'border-sky-400/50 bg-sky-400/[0.08] shadow-sm shadow-sky-400/10'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            isActive ? 'bg-sky-400/20 text-sky-300' : 'bg-white/10 text-mute group-hover:text-ink'
                          }`}
                        >
                          {ch.tag}
                        </span>
                        {isActive && (
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                        )}
                      </div>
                      <div className="mt-2 text-xs font-semibold tracking-tight text-ink group-hover:text-white">
                        {ch.title}
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] leading-4 text-mute">
                        {ch.desc}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
