import { useState, useEffect, useRef } from 'react'
import { Radio, AlertTriangle, Battery, X, TrendingUp, TrendingDown } from 'lucide-react'
import { Patient, Sensor, SimulationLog, triageConfig, sensorTypeConfig } from '../lib/supabase'
import { supabase } from '../lib/supabase'

interface Props {
  patients: Patient[]
  sensors: Sensor[]
  logs: SimulationLog[]
  onRefresh: () => void
}

interface ChartPoint {
  time: number
  value: number
  isAlert: boolean
}

export default function SensorMonitor({ patients, sensors, logs, onRefresh }: Props) {
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null)
  const [chartData, setChartData] = useState<Record<string, ChartPoint[]>>({})
  const [history, setHistory] = useState<Record<string, SensorReading[]>>({})
  const chartRef = useRef<HTMLCanvasElement | null>(null)

  interface SensorReading {
    value: number
    is_alert: boolean
    reading_time: string
  }

  // Load historical readings for selected patient
  useEffect(() => {
    if (!selectedPatient) return
    const patientSensors = sensors.filter((s) => s.patient_id === selectedPatient)
    async function loadHistory() {
      const newHistory: Record<string, SensorReading[]> = {}
      for (const s of patientSensors) {
        const { data } = await supabase.from('sensor_readings')
          .select('value,is_alert,reading_time')
          .eq('sensor_id', s.id)
          .order('reading_time', { ascending: false })
          .limit(30)
        newHistory[s.id] = (data || []).reverse() as SensorReading[]
      }
      setHistory(newHistory)
    }
    loadHistory()
  }, [selectedPatient, sensors])

  // Live chart data accumulation (poll every 2s)
  useEffect(() => {
    const interval = setInterval(() => {
      setChartData((prev) => {
        const next = { ...prev }
        for (const s of sensors) {
          if (s.status === 'offline' || s.last_reading === null) continue
          const key = s.id
          if (!next[key]) next[key] = []
          next[key] = [...next[key].slice(-39), { time: Date.now(), value: s.last_reading, isAlert: s.status === 'alert' }]
        }
        return next
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [sensors])

  const monitoredPatients = patients.filter((p) => p.is_monitored)
  const currentPatientData = selectedPatient ? patients.find((p) => p.id === selectedPatient) : monitoredPatients[0]
  const currentPatientId = currentPatientData?.id || null
  const currentSensors = currentPatientId ? sensors.filter((s) => s.patient_id === currentPatientId) : []
  const alertLogs = logs.filter((l) => l.event_type === 'ALERT' || l.severity === 'error').slice(0, 10)

  // Draw chart on canvas
  useEffect(() => {
    if (!chartRef.current || currentSensors.length === 0) return
    const canvas = chartRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width = canvas.offsetWidth * 2
    const H = canvas.height = 200
    ctx.scale(2, 2)
    const w = W / 2
    const h = H / 2

    ctx.clearRect(0, 0, w, h)

    // Draw grid
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // Draw each sensor's chart
    const colors = ['#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']
    currentSensors.forEach((sensor, idx) => {
      const data = chartData[sensor.id] || []
      if (data.length < 2) return
      const color = colors[idx % colors.length]
      const min = sensor.min_safe - (sensor.max_safe - sensor.min_safe) * 0.3
      const max = sensor.max_safe + (sensor.max_safe - sensor.min_safe) * 0.3
      const range = max - min

      // Safe zone band
      ctx.fillStyle = 'rgba(34, 197, 94, 0.06)'
      const safeY1 = h - ((sensor.max_safe - min) / range) * h
      const safeY2 = h - ((sensor.min_safe - min) / range) * h
      ctx.fillRect(0, safeY1, w, safeY2 - safeY1)

      // Data line
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      data.forEach((pt, i) => {
        const x = (i / (data.length - 1)) * w
        const y = h - ((pt.value - min) / range) * h
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Alert points
      ctx.fillStyle = '#ef4444'
      data.forEach((pt, i) => {
        if (pt.isAlert) {
          const x = (i / (data.length - 1)) * w
          const y = h - ((pt.value - min) / range) * h
          ctx.beginPath()
          ctx.arc(x, y, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      })
    })
  }, [chartData, currentSensors])

  return (
    <div className="space-y-6">
      {/* Patient selector tabs */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-5 h-5 text-accent-600" />
          <h3 className="text-lg font-bold text-slate-800">Sensor Monitor</h3>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {monitoredPatients.map((p) => {
            const isActive = currentPatientId === p.id
            const triage = triageConfig[p.triage_level as keyof typeof triageConfig] || triageConfig.green
            const pSensors = sensors.filter((s) => s.patient_id === p.id)
            const pAlerts = pSensors.filter((s) => s.status === 'alert').length
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPatient(p.id)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border-2 ${
                  isActive ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${triage.color === '#ef4444' ? 'bg-error-500' : triage.color === '#f59e0b' ? 'bg-warning-500' : 'bg-success-500'}`} />
                  {p.name}
                  {pAlerts > 0 && <span className="bg-error-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{pAlerts}</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {currentPatientData && (
        <>
          {/* Patient header */}
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center">
                  <span className="text-lg font-bold text-slate-600">{currentPatientData.pid}</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">{currentPatientData.name}</h3>
                  <p className="text-sm text-slate-500">
                    {currentPatientData.age ? `${currentPatientData.age}y` : ''} {currentPatientData.gender} · {currentPatientData.ward} · {currentPatientData.condition}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {(() => {
                  const triage = triageConfig[currentPatientData.triage_level as keyof typeof triageConfig] || triageConfig.green
                  return <span className={`badge ${triage.bg} ${triage.text} text-sm px-3 py-1`}>{triage.label}</span>
                })()}
              </div>
            </div>
          </div>

          {/* Live Chart */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Vital Signs — Live Chart</h3>
              <div className="flex items-center gap-3">
                {currentSensors.map((s, i) => {
                  const colors = ['#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']
                  return (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: colors[i % colors.length] }} />
                      <span className="text-xs text-slate-600">{s.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <canvas ref={chartRef} className="w-full" style={{ height: '200px' }} />
          </div>

          {/* Sensor Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentSensors.map((s) => {
              const cfg = sensorTypeConfig[s.type]
              const isAlert = s.status === 'alert'
              const isBelow = s.last_reading !== null && s.last_reading < s.min_safe
              const isAbove = s.last_reading !== null && s.last_reading > s.max_safe
              const data = chartData[s.id] || []
              const latest = data[data.length - 1]
              const prev = data[data.length - 2]
              const trend = latest && prev ? latest.value - prev.value : 0

              return (
                <div key={s.id} className={`card p-5 ${isAlert ? 'border-error-300 bg-error-50/20' : ''}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-slate-500">{s.label}</p>
                      <p className="text-xs text-slate-400 font-mono">{s.sensor_id}</p>
                    </div>
                    <span className={`badge ${isAlert ? 'bg-error-100 text-error-700' : 'bg-success-100 text-success-700'}`}>
                      {s.status === 'alert' ? 'ALERT' : s.status === 'offline' ? 'OFFLINE' : 'ONLINE'}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2 mb-2">
                    <span className={`text-3xl font-bold ${isAlert ? 'text-error-600' : 'text-slate-800'}`}>
                      {s.last_reading ?? '--'}
                    </span>
                    <span className="text-sm text-slate-400">{s.unit}</span>
                    {trend !== 0 && (
                      <span className={`flex items-center text-xs ${trend > 0 ? 'text-error-500' : 'text-success-500'}`}>
                        {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {Math.abs(trend).toFixed(1)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      Safe: {s.min_safe}–{s.max_safe} {s.unit}
                    </span>
                    <span className={`flex items-center gap-1 ${s.battery < 20 ? 'text-error-500' : 'text-slate-400'}`}>
                      <Battery className="w-3.5 h-3.5" />
                      {s.battery}%
                    </span>
                  </div>

                  {/* Threshold bar */}
                  <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden relative">
                    <div className="absolute inset-0 bg-success-100" style={{
                      left: `${Math.max(0, ((s.min_safe - (s.min_safe - 10)) / 50) * 100)}%`,
                      width: `${Math.min(100, ((s.max_safe - s.min_safe) / 50) * 100)}%`,
                    }} />
                    {s.last_reading !== null && (
                      <div className="absolute top-0 w-1 h-full rounded-full" style={{
                        left: `${Math.min(100, Math.max(0, ((s.last_reading - (s.min_safe - 10)) / 50) * 100))}%`,
                        backgroundColor: isAlert ? '#ef4444' : '#3b82f6',
                      }} />
                    )}
                  </div>
                  {isAlert && (
                    <p className="text-xs text-error-600 mt-2 font-medium">
                      {isBelow ? `Below safe range by ${(s.min_safe - (s.last_reading ?? 0)).toFixed(1)}${s.unit}` : `Above safe range by ${((s.last_reading ?? 0) - s.max_safe).toFixed(1)}${s.unit}`}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Recent Alerts */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-error-500" />
          <h3 className="text-lg font-bold text-slate-800">Recent Sensor Alerts</h3>
        </div>
        <div className="space-y-2">
          {alertLogs.length === 0 ? (
            <p className="text-sm text-slate-400">No alerts recorded. Start monitoring to generate sensor data.</p>
          ) : (
            alertLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 p-3 bg-error-50/40 rounded-xl border border-error-100">
                <AlertTriangle className="w-4 h-4 text-error-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-slate-700">{log.event_message}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{new Date(log.created_at).toLocaleTimeString()}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
