import React, { useState, useEffect, useRef } from 'react';
import { useEEGStore } from '../store/eeg';
import { Recording, RecordingFrame } from '../types';

const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕'
};

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  focused: { label: '专注', color: '#1976d2', icon: '🎯' },
  relaxed: { label: '放松', color: '#388e3c', icon: '🍃' },
  fatigued: { label: '疲劳', color: '#d32f2f', icon: '😴' },
  neutral: { label: '中性', color: '#9e9e9e', icon: '🧘' },
};

interface RecordingSummary {
  dominantStatus: string;
  dominantLabel: string;
  dominantColor: string;
  dominantIcon: string;
  avgFocus: number;
  avgRelaxation: number;
  avgFatigue: number;
  totalDuration: number;
  frameDuration: number;
  statusDistribution: {
    status: string;
    label: string;
    color: string;
    ratio: number;
    duration: number;
  }[];
  longestStreak: {
    status: string;
    label: string;
    color: string;
    icon: string;
    duration: number;
  } | null;
}

const computeRecordingSummary = (frames: RecordingFrame[]): RecordingSummary | null => {
  if (!frames || frames.length === 0) return null;

  let sumFocus = 0, sumRelaxation = 0, sumFatigue = 0;
  const statusCounts: Record<string, number> = {};
  const frameDuration = frames.length > 1
    ? (frames[frames.length - 1].relativeTime - frames[0].relativeTime) / (frames.length - 1)
    : 3;

  let longestStreakStatus = '';
  let longestStreakCount = 0;
  let currentStreakStatus = '';
  let currentStreakCount = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    sumFocus += frame.brainState.focus;
    sumRelaxation += frame.brainState.relaxation;
    sumFatigue += frame.brainState.fatigue;
    const s = frame.brainState.status;
    statusCounts[s] = (statusCounts[s] || 0) + 1;

    if (s === currentStreakStatus) {
      currentStreakCount++;
    } else {
      currentStreakStatus = s;
      currentStreakCount = 1;
    }
    if (currentStreakCount > longestStreakCount) {
      longestStreakCount = currentStreakCount;
      longestStreakStatus = s;
    }
  }

  const n = frames.length;
  const totalDuration = n * frameDuration;
  let dominantStatus = 'neutral';
  let maxCount = 0;
  for (const [status, count] of Object.entries(statusCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantStatus = status;
    }
  }

  const meta = STATUS_META[dominantStatus] || STATUS_META.neutral;
  const distribution = (['focused', 'relaxed', 'fatigued', 'neutral'] as const)
    .filter(s => statusCounts[s])
    .map(s => ({
      status: s,
      label: STATUS_META[s].label,
      color: STATUS_META[s].color,
      ratio: statusCounts[s] / n,
      duration: statusCounts[s] * frameDuration,
    }))
    .sort((a, b) => b.ratio - a.ratio);

  const streakMeta = longestStreakStatus ? (STATUS_META[longestStreakStatus] || STATUS_META.neutral) : null;

  return {
    dominantStatus,
    dominantLabel: meta.label,
    dominantColor: meta.color,
    dominantIcon: meta.icon,
    avgFocus: sumFocus / n,
    avgRelaxation: sumRelaxation / n,
    avgFatigue: sumFatigue / n,
    totalDuration,
    frameDuration,
    statusDistribution: distribution,
    longestStreak: streakMeta ? {
      status: longestStreakStatus,
      label: streakMeta.label,
      color: streakMeta.color,
      icon: streakMeta.icon,
      duration: longestStreakCount * frameDuration,
    } : null,
  };
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTime = (ms: number): string => {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const RecordingPanel: React.FC = () => {
  const {
    isRecording,
    currentRecordingFrames,
    recordings,
    playbackMode,
    activeRecording,
    playbackState,
    startRecording,
    stopRecording,
    deleteRecording,
    enterPlaybackMode,
    exitPlaybackMode,
    setPlaybackTime,
    togglePlayback,
    setPlaybackPlaying,
    selectedChannel,
  } = useEEGStore();

  const [recordingName, setRecordingName] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setElapsedTime(currentRecordingFrames.length * 3);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, currentRecordingFrames.length]);

  useEffect(() => {
    if (playbackState.isPlaying && activeRecording) {
      playbackTimerRef.current = window.setInterval(() => {
        const { playbackState, activeRecording, setPlaybackTime, setPlaybackPlaying } = useEEGStore.getState();
        if (!activeRecording) return;
        const newTime = playbackState.currentTime + 0.1;
        if (newTime >= activeRecording.duration) {
          setPlaybackTime(activeRecording.duration);
          setPlaybackPlaying(false);
        } else {
          setPlaybackTime(newTime);
        }
      }, 100);
    } else {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    }
    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, [playbackState.isPlaying, activeRecording]);

  const handleStartRecording = () => {
    startRecording();
  };

  const handleStopRecording = () => {
    setShowNameDialog(true);
  };

  const handleConfirmSave = () => {
    stopRecording(recordingName.trim());
    setRecordingName('');
    setShowNameDialog(false);
  };

  const handleCancelSave = () => {
    useEEGStore.setState({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
    });
    setShowNameDialog(false);
    setRecordingName('');
  };

  const handlePlayRecording = (recording: Recording) => {
    enterPlaybackMode(recording);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setPlaybackTime(time);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const time = percentage * activeRecording.duration;
    setPlaybackTime(time);
  };

  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>⏺</span>
        录制与回放
      </h3>

      {!playbackMode && (
        <div style={{ marginBottom: '16px' }}>
          {!isRecording ? (
            <button
              onClick={handleStartRecording}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #d32f2f, #b71c1c)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span style={{ fontSize: '16px' }}>⏺</span>
              开始录制 ({CHANNEL_NAMES[selectedChannel] || selectedChannel})
            </button>
          ) : (
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                background: '#ffebee',
                borderRadius: '8px',
                marginBottom: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: '#d32f2f',
                    animation: 'pulse 1s infinite',
                  }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#d32f2f' }}>录制中</span>
                </div>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                  {formatDuration(elapsedTime)} · {currentRecordingFrames.length} 帧
                </span>
              </div>
              <button
                onClick={handleStopRecording}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#757575',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⏹ 停止录制
              </button>
            </div>
          )}
        </div>
      )}

      {playbackMode && activeRecording && (
        <div style={{
          marginBottom: '16px',
          padding: '14px',
          background: 'linear-gradient(135deg, #e3f2fd, #bbdefb)',
          borderRadius: '10px',
          border: '1px solid #90caf9',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>
                {activeRecording.name}
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                {CHANNEL_NAMES[activeRecording.channel] || activeRecording.channel} · {formatDuration(activeRecording.duration)}
              </div>
            </div>
            <button
              onClick={exitPlaybackMode}
              style={{
                padding: '6px 12px',
                background: '#fff',
                color: '#1565c0',
                border: '1px solid #90caf9',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              退出回放
            </button>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '10px',
          }}>
            <button
              onClick={togglePlayback}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: '#1565c0',
                color: '#fff',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {playbackState.isPlaying ? '⏸' : '▶'}
            </button>

            <div style={{ flex: 1 }}>
              <div
                onClick={handleProgressClick}
                style={{
                  height: '8px',
                  background: '#90caf9',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: '#1565c0',
                    width: `${(playbackState.currentTime / activeRecording.duration) * 100}%`,
                    borderRadius: '4px',
                    transition: 'width 0.1s linear',
                  }}
                />
              </div>
              <input
                type="range"
                min="0"
                max={activeRecording.duration}
                step="0.1"
                value={playbackState.currentTime}
                onChange={handleSeek}
                style={{
                  width: '100%',
                  marginTop: '4px',
                  opacity: 0,
                  position: 'absolute',
                  pointerEvents: 'none',
                }}
              />
            </div>

            <span style={{ fontSize: '12px', color: '#666', minWidth: '70px', textAlign: 'right' }}>
              {formatDuration(playbackState.currentTime)} / {formatDuration(activeRecording.duration)}
            </span>
          </div>

          {playbackState.currentFrame && (
            <div style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              padding: '8px',
              background: 'rgba(255,255,255,0.5)',
              borderRadius: '6px',
            }}>
              <span style={{ fontSize: '11px', color: '#1976d2' }}>专注: {playbackState.currentFrame.brainState.focus.toFixed(0)}</span>
              <span style={{ fontSize: '11px', color: '#388e3c' }}>放松: {playbackState.currentFrame.brainState.relaxation.toFixed(0)}</span>
              <span style={{ fontSize: '11px', color: '#d32f2f' }}>疲劳: {playbackState.currentFrame.brainState.fatigue.toFixed(0)}</span>
              <span style={{ fontSize: '11px', color: '#666' }}>|</span>
              <span style={{ fontSize: '11px', color: '#1565c0' }}>α: {playbackState.currentFrame.bands.alpha.toFixed(2)}</span>
              <span style={{ fontSize: '11px', color: '#e53935' }}>β: {playbackState.currentFrame.bands.beta.toFixed(2)}</span>
              <span style={{ fontSize: '11px', color: '#2e7d32' }}>θ: {playbackState.currentFrame.bands.theta.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      <div>
        <div style={{
          fontSize: '12px',
          color: '#666',
          marginBottom: '8px',
          fontWeight: 500,
        }}>
          历史录制 ({recordings.length})
        </div>
        {recordings.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px',
            border: '1px dashed #e0e0e0',
            borderRadius: '8px',
          }}>
            暂无录制记录
          </div>
        ) : (
          <div style={{ maxHeight: '280px', overflow: 'auto' }}>
            {[...recordings].reverse().map((recording) => (
              <div
                key={recording.id}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: activeRecording?.id === recording.id
                    ? '2px solid #1565c0'
                    : '1px solid #e0e0e0',
                  marginBottom: '8px',
                  background: activeRecording?.id === recording.id ? '#e3f2fd' : '#fff',
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '6px',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#333',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {recording.name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                      {formatTime(recording.startTime)} · {CHANNEL_NAMES[recording.channel] || recording.channel}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      onClick={() => handlePlayRecording(recording)}
                      style={{
                        padding: '4px 10px',
                        background: activeRecording?.id === recording.id ? '#1565c0' : '#f5f5f5',
                        color: activeRecording?.id === recording.id ? '#fff' : '#1565c0',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {activeRecording?.id === recording.id ? '回放中' : '▶ 回放'}
                    </button>
                    <button
                      onClick={() => deleteRecording(recording.id)}
                      style={{
                        padding: '4px 8px',
                        background: '#ffebee',
                        color: '#d32f2f',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
                {(() => {
                  const summary = computeRecordingSummary(recording.frames);
                  const dominantRatio = summary?.statusDistribution.find(s => s.status === summary?.dominantStatus)?.ratio ?? 0;
                  return (
                    <div style={{
                      padding: '10px',
                      borderRadius: '8px',
                      background: summary
                        ? `linear-gradient(135deg, ${summary.dominantColor}10, ${summary.dominantColor}06)`
                        : '#fafafa',
                      border: summary
                        ? `1px solid ${summary.dominantColor}30`
                        : '1px solid #eee',
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '8px',
                      }}>
                        <div style={{
                          minWidth: '72px',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          background: '#fff',
                          border: '1px solid #e0e0e0',
                          textAlign: 'center',
                        }}>
                          <div style={{ fontSize: '9px', color: '#999', lineHeight: 1.2 }}>总时长</div>
                          <div style={{
                            fontSize: '16px',
                            fontWeight: 800,
                            color: '#333',
                            lineHeight: 1.2,
                            letterSpacing: '0.5px',
                            marginTop: '2px',
                          }}>
                            {formatDuration(recording.duration)}
                          </div>
                          <div style={{ fontSize: '9px', color: '#bbb', marginTop: '2px' }}>{recording.frames.length} 帧</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {summary ? (
                            <>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginBottom: '4px',
                                flexWrap: 'wrap',
                              }}>
                                <span style={{ fontSize: '16px' }}>{summary.dominantIcon}</span>
                                <span style={{
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  color: summary.dominantColor,
                                }}>
                                  主要: {summary.dominantLabel}
                                </span>
                                <span style={{
                                  fontSize: '10px',
                                  color: '#fff',
                                  background: summary.dominantColor,
                                  padding: '1px 6px',
                                  borderRadius: '8px',
                                  fontWeight: 600,
                                }}>
                                  {formatDuration(summary.statusDistribution[0].duration)} · {(dominantRatio * 100).toFixed(0)}%
                                </span>
                              </div>
                              {summary.longestStreak && summary.longestStreak.status !== summary.dominantStatus
                                ? (
                                  <div style={{
                                    fontSize: '10px',
                                    color: '#666',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    flexWrap: 'wrap',
                                  }}>
                                    <span style={{ opacity: 0.8 }}>最久连续</span>
                                    <span>{summary.longestStreak.icon}</span>
                                    <span style={{ color: summary.longestStreak.color, fontWeight: 600 }}>
                                      {summary.longestStreak.label}
                                    </span>
                                    <span style={{
                                      background: `${summary.longestStreak.color}15`,
                                      color: summary.longestStreak.color,
                                      padding: '0 5px',
                                      borderRadius: '6px',
                                      fontWeight: 600,
                                    }}>
                                      {formatDuration(summary.longestStreak.duration)}
                                    </span>
                                  </div>
                                )
                                : (
                                  summary.longestStreak && (
                                    <div style={{
                                      fontSize: '10px',
                                      color: '#888',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                    }}>
                                      <span>最久连续</span>
                                      <span style={{
                                        background: `${summary.longestStreak.color}15`,
                                        color: summary.longestStreak.color,
                                        padding: '0 5px',
                                        borderRadius: '6px',
                                        fontWeight: 600,
                                      }}>
                                        {formatDuration(summary.longestStreak.duration)}
                                      </span>
                                    </div>
                                  )
                                )
                              }
                            </>
                          ) : (
                            <div style={{ fontSize: '11px', color: '#999' }}>无帧数据</div>
                          )}
                        </div>
                      </div>

                      {summary && (
                        <>
                          <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>专注</div>
                              <div style={{ height: '4px', background: '#e0e0e0', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.min(100, summary.avgFocus)}%`, background: '#1976d2', borderRadius: '2px' }} />
                              </div>
                              <div style={{ fontSize: '10px', color: '#1976d2', fontWeight: 600, marginTop: '1px' }}>{summary.avgFocus.toFixed(0)}</div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>放松</div>
                              <div style={{ height: '4px', background: '#e0e0e0', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.min(100, summary.avgRelaxation)}%`, background: '#388e3c', borderRadius: '2px' }} />
                              </div>
                              <div style={{ fontSize: '10px', color: '#388e3c', fontWeight: 600, marginTop: '1px' }}>{summary.avgRelaxation.toFixed(0)}</div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>疲劳</div>
                              <div style={{ height: '4px', background: '#e0e0e0', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.min(100, summary.avgFatigue)}%`, background: '#d32f2f', borderRadius: '2px' }} />
                              </div>
                              <div style={{ fontSize: '10px', color: '#d32f2f', fontWeight: 600, marginTop: '1px' }}>{summary.avgFatigue.toFixed(0)}</div>
                            </div>
                          </div>

                          <div style={{
                            display: 'flex',
                            height: '6px',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            background: '#f5f5f5',
                            marginBottom: '6px',
                          }}>
                            {summary.statusDistribution.map(d => (
                              <div
                                key={d.status}
                                style={{
                                  width: `${d.ratio * 100}%`,
                                  background: d.color,
                                }}
                                title={`${d.label} ${formatDuration(d.duration)} (${(d.ratio * 100).toFixed(0)}%)`}
                              />
                            ))}
                          </div>

                          <div style={{
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                          }}>
                            {summary.statusDistribution.map(d => (
                              <span
                                key={d.status}
                                style={{
                                  fontSize: '10px',
                                  color: '#555',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '2px 6px',
                                  background: `${d.color}10`,
                                  border: `1px solid ${d.color}25`,
                                  borderRadius: '10px',
                                  lineHeight: 1.4,
                                }}
                              >
                                <span style={{
                                  width: '6px',
                                  height: '6px',
                                  borderRadius: '50%',
                                  background: d.color,
                                  display: 'inline-block',
                                  flexShrink: 0,
                                }} />
                                <span style={{ fontWeight: 600, color: d.color }}>{d.label}</span>
                                <span style={{ color: '#333', fontWeight: 700 }}>{formatDuration(d.duration)}</span>
                                <span style={{ color: '#999', fontSize: '9px' }}>{(d.ratio * 100).toFixed(0)}%</span>
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      {showNameDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#fff',
            padding: '24px',
            borderRadius: '12px',
            width: '320px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <h4 style={{ margin: '0 0 16px', fontSize: '16px', color: '#333' }}>
              保存录制
            </h4>
            <input
              type="text"
              value={recordingName}
              onChange={(e) => setRecordingName(e.target.value)}
              placeholder="输入录制名称（可选）"
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                marginBottom: '16px',
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmSave();
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelSave}
                style={{
                  padding: '8px 16px',
                  background: '#f5f5f5',
                  color: '#666',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirmSave}
                style={{
                  padding: '8px 16px',
                  background: '#1565c0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};
