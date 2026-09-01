import { useState, useEffect, useRef } from 'react'
import { Heart, Activity, AlertTriangle, Users, TrendingUp, Radio, ChevronRight, X } from 'lucide-react'
import { Resource, Patient, Sensor, SimulationLog, triageConfig, sensorTypeConfig } from '../lib/supabase'
import { View } from '../App'

interface Props {
  resources: Resource[]
  patients: Patient[]
  sensors: Sensor[]
  logs: SimulationLog[]
  monitoring: boolean
  onNavigate: (v: View) => void
  onRefresh: () => void
}

interface ChartPoint {
  time: number
  value: number
  isAlert: boolean
}

export default function LiveDashboard({ resources, patients, sensors, logs, monitoring, onNavigate, onRefresh }: Props) {
  const [chartData, setChartData] = useState<Record<string, ChartPoint[]>>({})
  const [selectedAlert, setSelectedAlert] = useState<SimulationLog | null>(null)

  const monitoredPatients = patients.filter((p) => p.is_monitored)
  const redPatients = patients.filter((p) => p.triage_level === 'red')
  const yellowPatients = patients.filter((p) => p.triage_level === 'yellow')
  const alertSensors = sensors.filter((s) => s.status === 'alert')
  const totalResources = resources.reduce((s, r) => s + r.total, 0)
  const availableResources = resources.reduce((s, r) => s + r.available, 0)
  const utilization = totalResources > 0 ? ((1 - availableResources / totalResources) * 100).toFixed(0) : '0'

  // Live chart data accumulation
  useEffect(() => {
    if (!monitoring) return
    const interval = setInterval(() => {
      setChartData((prev) => {
        const next = { ...prev }
        for (const s of sensors) {
          if (s.status === 'offline' || !s.last_reading) continue
          const key = s.id
          if (!next[key]) next[key] = []
          const point: ChartPoint = {
            time: Date.now(),
            value: s.last_reading,
            isAlert: s.status === 'alert',
          }
          next[key] = [...next[key].slice(-29), point]
        }
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [monitoring, sensors])

  const stats = [
    { label: 'Monitored Patients', value: monitoredPatients.length, icon: Users, color: 'from-primary-500 to-primary-600', sub: `${redPatients.length} critical` },
    { label: 'Active Alerts', value: alertSensors.length, icon: AlertTriangle, color: 'from-error-500 to-error-600', sub: alertSensors.length > 0 ? 'Needs attention' : 'All clear' },
    { label: 'Resource Utilization', value: `${utilization}%`, icon: TrendingUp, color: 'from-accent-500 to-accent-600', sub: `${availableResources} units free` },
    { label: 'Online Sensors', value: sensors.filter((s) => s.status !== 'offline').length, icon: Radio, color: 'from-success-500 to-success-600', sub: `of ${sensors.length} total` },
  ]

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
                  <p className="text-3xl font-bold text-slate-800 mt-1">{stat.value}</p>
                  <p className="text-xs text-slate-400 mt-1">{stat.sub}</p>
                </div>
                <div className={`w-12 h-12 bg-gradient-to-br ${stat.color} rounded-xl flex items-center justify-center shadow-lg`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Critical Patients */}
      {redPatients.length > 0 && (
        <div className="card p-6 border-error-200 bg-error-50/30">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-error-500" />
            <h3 className="text-lg font-bold text-slate-800">Critical Patients — Immediate Attention</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {redPatients.map((p) => {
              const patientSensors = sensors.filter((s) => s.patient_id === p.id)
              const alertSensorsForPatient = patientSensors.filter((s) => s.status === 'alert')
              return (
                <div key={p.id} className="bg-white rounded-xl p-4 border border-error-200 cursor-pointer hover:shadow-md transition-all" onClick={() => onNavigate('sensors')}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-bold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">PID {p.pid} · {p.ward}</p>
                    </div>
                    <span className="badge bg-error-100 text-error-700">CRITICAL</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {alertSensorsForPatient.map((s) => (
                      <span key={s.id} className="text-xs px-2 py-1 bg-error-100 text-error-700 rounded-lg font-medium">
                        {s.label}: {s.last_reading}{s.unit}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Live Sensor Grid */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-accent-600" />
            <h3 className="text-lg font-bold text-slate-800">Live Sensor Readings</h3>
            {monitoring && (
              <span className="flex items-center gap-1.5 text-xs text-success-600 font-medium">
                <span className="w-2 h-2 bg-success-500 rounded-full animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <button onClick={() => onNavigate('sensors')} className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
            View All <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {monitoredPatients.map((p) => {
            const patientSensors = sensors.filter((s) => s.patient_id === p.id)
            const triage = triageConfig[p.triage_level as keyof typeof triageConfig] || triageConfig.green
            return (
              <div key={p.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200/60">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{p.name}</p>
                    <p className="text-xs text-slate-400">PID {p.pid}</p>
                  </div>
                  <span className={`badge ${triage.bg} ${triage.text}`}>{triage.label}</span>
                </div>
                <div className="space-y-2">
                  {patientSensors.slice(0, 4).map((s) => {
                    const cfg = sensorTypeConfig[s.type]
                    const isAlert = s.status === 'alert'
                    const chart = chartData[s.id] || []
                    return (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className="text-sm w-5">{cfg?.icon || '📊'}</span>
                        <span className="text-xs text-slate-500 flex-1 truncate">{s.label}</span>
                        <span className={`text-sm font-mono font-bold ${isAlert ? 'text-error-600' : 'text-slate-700'}`}>
                          {s.last_reading ?? '--'}{s.unit}
                        </span>
                        {/* Mini sparkline */}
                        {chart.length > 1 && (
                          <svg width="40" height="16" className="flex-shrink-0">
                            <polyline
                              points={chart.map((pt, i) => `${(i / (chart.length - 1)) * 40},${16 - ((pt.value - s.min_safe) / (s.max_safe - s.min_safe)) * 16}`).join(' ')}
                              fill="none"
                              stroke={isAlert ? '#ef4444' : '#22c55e'}
                              strokeWidth="1.5"
                            />
                          </svg>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Activity Log */}
      <div className="card p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">System Activity & Alerts</h3>
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-sm text-slate-400">No activity yet. Start monitoring to generate readings.</p>
          ) : (
            logs.map((log) => {
              const color = log.severity === 'error' ? 'text-error-500' : log.severity === 'warning' ? 'text-warning-500' : log.severity === 'success' ? 'text-success-500' : 'text-slate-400'
              const Icon = log.severity === 'error' ? AlertTriangle : log.severity === 'success' ? Heart : Activity
              return (
                <div key={log.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedAlert(log)}>
                  <Icon className={`w-4 h-4 mt-0.5 ${color} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700">{log.event_message}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      <span className="font-medium">{log.event_type}</span> · {new Date(log.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Alert detail modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50" onClick={() => setSelectedAlert(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Event Details</h3>
              <button onClick={() => setSelectedAlert(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-700 mb-3">{selectedAlert.event_message}</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Type:</span><span className="font-medium text-slate-700">{selectedAlert.event_type}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Severity:</span><span className="font-medium text-slate-700 capitalize">{selectedAlert.severity}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Time:</span><span className="font-medium text-slate-700">{new Date(selectedAlert.created_at).toLocaleString()}</span></div>
              {selectedAlert.details && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-slate-500 mb-1">Details:</p>
                  <pre className="text-xs bg-slate-50 rounded-lg p-3 overflow-x-auto text-slate-600">{JSON.stringify(selectedAlert.details, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
