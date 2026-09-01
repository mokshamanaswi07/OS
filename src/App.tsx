import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, LayoutDashboard, Users, Radio, Stethoscope, AlertTriangle, Heart } from 'lucide-react'
import { supabase, Resource, Patient, Sensor, SimulationLog } from './lib/supabase'
import { pollSensors } from './lib/simulation'
import LiveDashboard from './components/LiveDashboard'
import PatientManager from './components/PatientManager'
import SensorMonitor from './components/SensorMonitor'
import ResourceManager from './components/ResourceManager'

export type View = 'dashboard' | 'patients' | 'sensors' | 'resources'

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [resources, setResources] = useState<Resource[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [sensors, setSensors] = useState<Sensor[]>([])
  const [logs, setLogs] = useState<SimulationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [monitoring, setMonitoring] = useState(false)
  const [alertCount, setAlertCount] = useState(0)
  const monitorRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'dashboard', label: 'Live Monitor', icon: LayoutDashboard },
    { id: 'patients', label: 'Patients', icon: Users },
    { id: 'sensors', label: 'Sensors', icon: Radio },
    { id: 'resources', label: 'Resources', icon: Stethoscope },
  ]

  const fetchData = useCallback(async () => {
    const [res, pat, sen, log] = await Promise.all([
      supabase.from('resources').select('*').order('category'),
      supabase.from('patients').select('*').order('pid'),
      supabase.from('sensors').select('*').order('sensor_id'),
      supabase.from('simulation_logs').select('*').order('created_at', { ascending: false }).limit(60),
    ])
    setResources(res.data || [])
    setPatients(pat.data || [])
    setSensors(sen.data || [])
    setLogs(log.data || [])
    setAlertCount((sen.data || []).filter((s: Sensor) => s.status === 'alert').length)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Live monitoring loop
  const startMonitoring = useCallback(() => {
    if (monitorRef.current) return
    setMonitoring(true)
    monitorRef.current = setInterval(async () => {
      const result = await pollSensors(sensors, patients)
      if (result.alerts.length > 0 || result.triageUpdates.length > 0) {
        fetchData()
      } else {
        // Light refresh of just sensors + logs
        const [sen, log] = await Promise.all([
          supabase.from('sensors').select('*').order('sensor_id'),
          supabase.from('simulation_logs').select('*').order('created_at', { ascending: false }).limit(60),
        ])
        setSensors(sen.data || [])
        setLogs(log.data || [])
        setAlertCount((sen.data || []).filter((s: Sensor) => s.status === 'alert').length)
      }
    }, 3000)
  }, [sensors, patients, fetchData])

  const stopMonitoring = useCallback(() => {
    if (monitorRef.current) {
      clearInterval(monitorRef.current)
      monitorRef.current = null
    }
    setMonitoring(false)
  }, [])

  useEffect(() => {
    return () => { if (monitorRef.current) clearInterval(monitorRef.current) }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col fixed h-screen z-20">
        <div className="px-6 py-6 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-accent-500 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base leading-tight">Hospital OS</h1>
              <p className="text-xs text-slate-400">Patient Monitoring</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  active ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
                {item.id === 'dashboard' && alertCount > 0 && (
                  <span className="ml-auto bg-error-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">{alertCount}</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Monitoring control */}
        <div className="px-4 py-4 border-t border-slate-700/50">
          <button
            onClick={monitoring ? stopMonitoring : startMonitoring}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              monitoring
                ? 'bg-error-500/20 text-error-400 border border-error-500/30 hover:bg-error-500/30'
                : 'bg-success-500/20 text-success-400 border border-success-500/30 hover:bg-success-500/30'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${monitoring ? 'bg-error-400 animate-pulse' : 'bg-success-400'}`} />
            {monitoring ? 'Monitoring Active' : 'Start Monitoring'}
          </button>
          <p className="text-[10px] text-slate-500 mt-2 text-center">
            {monitoring ? 'Polling sensors every 3s' : 'Click to start live sensor polling'}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-64 min-h-screen">
        <header className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                {navItems.find((n) => n.id === view)?.label}
              </h2>
              <p className="text-sm text-slate-500">Virtual General Hospital — Real-time Patient Monitoring System</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-xs text-slate-400">Monitored Patients</p>
                <p className="text-lg font-bold text-slate-700">{patients.filter((p) => p.is_monitored).length}</p>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-right">
                <p className="text-xs text-slate-400">Active Sensors</p>
                <p className="text-lg font-bold text-slate-700">{sensors.filter((s) => s.status !== 'offline').length}</p>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-right">
                <p className="text-xs text-slate-400">Active Alerts</p>
                <p className={`text-lg font-bold ${alertCount > 0 ? 'text-error-600' : 'text-slate-700'}`}>{alertCount}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="p-8">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="animate-fade-in">
              {view === 'dashboard' && (
                <LiveDashboard resources={resources} patients={patients} sensors={sensors} logs={logs} monitoring={monitoring} onNavigate={setView} onRefresh={fetchData} />
              )}
              {view === 'patients' && <PatientManager patients={patients} sensors={sensors} onRefresh={fetchData} />}
              {view === 'sensors' && <SensorMonitor patients={patients} sensors={sensors} logs={logs} onRefresh={fetchData} />}
              {view === 'resources' && <ResourceManager resources={resources} patients={patients} sensors={sensors} onRefresh={fetchData} />}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
