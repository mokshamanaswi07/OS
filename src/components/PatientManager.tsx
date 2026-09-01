import { useState } from 'react'
import { UserPlus, Trash2, Radio, X, Users, Heart, Shield } from 'lucide-react'
import { Patient, Sensor, triageConfig } from '../lib/supabase'
import { supabase } from '../lib/supabase'

interface Props {
  patients: Patient[]
  sensors: Sensor[]
  onRefresh: () => void
}

export default function PatientManager({ patients, sensors, onRefresh }: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [showSensors, setShowSensors] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', age: '', gender: 'male', condition: 'stable', ward: 'general', phone: '', emergency: '',
  })

  const nextPid = Math.max(...patients.map((p) => p.pid), 100) + 1

  async function addPatient() {
    if (!form.name.trim()) return
    const priority = form.condition === 'critical' ? 1 : form.condition === 'serious' ? 2 : form.condition === 'fair' ? 3 : 5
    const triage = form.condition === 'critical' ? 'red' : form.condition === 'serious' ? 'yellow' : 'green'
    const { error } = await supabase.from('patients').insert({
      pid: nextPid,
      name: form.name,
      age: form.age ? parseInt(form.age) : null,
      gender: form.gender,
      condition: form.condition,
      priority,
      arrival_time: 0,
      burst_time: Math.floor(Math.random() * 6) + 2,
      status: 'waiting',
      ward: form.ward,
      memory_required: form.condition === 'critical' ? 4 : form.condition === 'serious' ? 2 : 1,
      triage_level: triage,
      is_monitored: false,
      phone: form.phone || null,
      emergency_contact: form.emergency || null,
    })
    if (error) { console.error(error); return }

    await supabase.from('simulation_logs').insert({
      event_type: 'PATIENT',
      event_message: `New patient admitted: ${form.name} (PID ${nextPid}) — ${form.condition}`,
      severity: form.condition === 'critical' ? 'error' : 'info',
      details: { name: form.name, pid: nextPid, condition: form.condition, ward: form.ward },
    })
    setForm({ name: '', age: '', gender: 'male', condition: 'stable', ward: 'general', phone: '', emergency: '' })
    setShowAdd(false)
    onRefresh()
  }

  async function deletePatient(id: string) {
    const patient = patients.find((p) => p.id === id)
    if (!patient) return
    await supabase.from('patients').delete().eq('id', id)
    await supabase.from('simulation_logs').insert({
      event_type: 'PATIENT',
      event_message: `Patient discharged: ${patient.name} (PID ${patient.pid})`,
      severity: 'info',
    })
    onRefresh()
  }

  async function toggleMonitoring(patientId: string, current: boolean) {
    await supabase.from('patients').update({ is_monitored: !current, updated_at: new Date().toISOString() }).eq('id', patientId)
    const patient = patients.find((p) => p.id === patientId)
    await supabase.from('simulation_logs').insert({
      event_type: 'PATIENT',
      event_message: `${patient?.name}: ${!current ? 'monitoring enabled' : 'monitoring disabled'}`,
      severity: !current ? 'success' : 'info',
    })
    onRefresh()
  }

  async function addSensorToPatient(patientId: string, type: string) {
    const patient = patients.find((p) => p.id === patientId)
    if (!patient) return
    const cfg = sensorDefaults[type]
    const sensorId = `SEN-${patient.pid}-${type.toUpperCase().slice(0, 4)}`
    const { error } = await supabase.from('sensors').insert({
      sensor_id: sensorId,
      patient_id: patientId,
      type,
      label: cfg.label,
      unit: cfg.unit,
      status: 'online',
      battery: 100,
      min_safe: cfg.min,
      max_safe: cfg.max,
      last_reading: (cfg.min + cfg.max) / 2,
      last_reading_at: new Date().toISOString(),
    })
    if (error) { console.error(error); return }
    // Enable monitoring
    await supabase.from('patients').update({ is_monitored: true, updated_at: new Date().toISOString() }).eq('id', patientId)
    await supabase.from('simulation_logs').insert({
      event_type: 'SENSOR',
      event_message: `Sensor ${cfg.label} attached to ${patient.name} (PID ${patient.pid})`,
      severity: 'success',
      details: { sensor_id: sensorId, type, patient: patient.name },
    })
    onRefresh()
  }

  async function removeSensor(sensorId: string) {
    const sensor = sensors.find((s) => s.id === sensorId)
    if (!sensor) return
    await supabase.from('sensors').delete().eq('id', sensorId)
    await supabase.from('simulation_logs').insert({
      event_type: 'SENSOR',
      event_message: `Sensor ${sensor.label} removed`,
      severity: 'warning',
    })
    onRefresh()
  }

  const sensorDefaults: Record<string, { label: string; unit: string; min: number; max: number }> = {
    heart_rate: { label: 'Heart Rate', unit: 'bpm', min: 60, max: 100 },
    spo2: { label: 'Blood Oxygen', unit: '%', min: 95, max: 100 },
    blood_pressure: { label: 'Blood Pressure', unit: 'mmHg', min: 90, max: 140 },
    temperature: { label: 'Temperature', unit: '°C', min: 36.0, max: 37.5 },
    respiration: { label: 'Respiration', unit: 'breaths/min', min: 12, max: 20 },
    ecg: { label: 'ECG', unit: 'mV', min: -2, max: 2 },
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">Patient Registry</h3>
            <p className="text-sm text-slate-500">{patients.length} patients · {patients.filter((p) => p.is_monitored).length} monitored</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <UserPlus className="w-4 h-4" />
          Admit Patient
        </button>
      </div>

      {/* Patient Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {patients.map((p) => {
          const triage = triageConfig[p.triage_level as keyof typeof triageConfig] || triageConfig.green
          const patientSensors = sensors.filter((s) => s.patient_id === p.id)
          const alertCount = patientSensors.filter((s) => s.status === 'alert').length
          return (
            <div key={p.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center">
                    <span className="text-sm font-bold text-slate-600">{p.pid}</span>
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.age ? `${p.age}y` : ''} {p.gender} · {p.ward}</p>
                  </div>
                </div>
                <span className={`badge ${triage.bg} ${triage.text}`}>{triage.label}</span>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span className={`badge ${p.condition === 'critical' ? 'bg-error-100 text-error-700' : p.condition === 'serious' ? 'bg-warning-100 text-warning-700' : 'bg-success-100 text-success-700'}`}>
                  {p.condition}
                </span>
                {p.is_monitored ? (
                  <span className="badge bg-accent-100 text-accent-700 flex items-center gap-1">
                    <Radio className="w-3 h-3" /> {patientSensors.length} sensors
                  </span>
                ) : (
                  <span className="badge bg-slate-100 text-slate-500">Not monitored</span>
                )}
                {alertCount > 0 && <span className="badge bg-error-100 text-error-700">{alertCount} alerts</span>}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <button onClick={() => setShowSensors(p.id)} className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1">
                  <Radio className="w-3.5 h-3.5" /> Manage Sensors
                </button>
                <button onClick={() => toggleMonitoring(p.id, p.is_monitored)} className={`text-xs font-medium ${p.is_monitored ? 'text-warning-600 hover:text-warning-700' : 'text-success-600 hover:text-success-700'}`}>
                  {p.is_monitored ? 'Stop Monitoring' : 'Start Monitoring'}
                </button>
                <button onClick={() => deletePatient(p.id)} className="ml-auto text-error-500 hover:text-error-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Patient Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Admit New Patient</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="John Doe" />
              </div>
              <div>
                <label className="label">Age</label>
                <input className="input" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="45" />
              </div>
              <div>
                <label className="label">Gender</label>
                <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Condition</label>
                <select className="input" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                  <option value="stable">Stable</option>
                  <option value="fair">Fair</option>
                  <option value="serious">Serious</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="label">Ward</label>
                <select className="input" value={form.ward} onChange={(e) => setForm({ ...form, ward: e.target.value })}>
                  <option value="general">General</option>
                  <option value="ICU">ICU</option>
                  <option value="Emergency">Emergency</option>
                  <option value="Surgical">Surgical</option>
                </select>
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="555-0123" />
              </div>
              <div className="col-span-2">
                <label className="label">Emergency Contact</label>
                <input className="input" value={form.emergency} onChange={(e) => setForm({ ...form, emergency: e.target.value })} placeholder="Jane Doe (spouse)" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={addPatient} disabled={!form.name.trim()} className="btn-primary flex-1">
                <UserPlus className="w-4 h-4" /> Admit Patient
              </button>
              <button onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Sensor Management Modal */}
      {showSensors && (() => {
        const patient = patients.find((p) => p.id === showSensors)
        if (!patient) return null
        const patientSensors = sensors.filter((s) => s.patient_id === patient.id)
        const availableTypes = Object.keys(sensorDefaults).filter((t) => !patientSensors.some((s) => s.type === t))
        return (
          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50" onClick={() => setShowSensors(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Sensors — {patient.name}</h3>
                  <p className="text-sm text-slate-500">PID {patient.pid}</p>
                </div>
                <button onClick={() => setShowSensors(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              {/* Attached sensors */}
              <div className="space-y-2 mb-4">
                {patientSensors.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No sensors attached yet</p>
                ) : (
                  patientSensors.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                      <Radio className={`w-4 h-4 ${s.status === 'alert' ? 'text-error-500' : 'text-success-500'}`} />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">{s.label}</p>
                        <p className="text-xs text-slate-400">{s.sensor_id} · {s.last_reading}{s.unit} · {s.battery}% battery</p>
                      </div>
                      <button onClick={() => removeSensor(s.id)} className="text-error-500 hover:text-error-600"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))
                )}
              </div>

              {/* Available to add */}
              {availableTypes.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-2">Attach New Sensor:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {availableTypes.map((type) => (
                      <button key={type} onClick={() => addSensorToPatient(patient.id, type)} className="flex items-center gap-2 p-3 rounded-xl border-2 border-slate-200 hover:border-primary-400 hover:bg-primary-50 transition-all text-left">
                        <Radio className="w-4 h-4 text-primary-500" />
                        <div>
                          <p className="text-sm font-medium text-slate-700">{sensorDefaults[type].label}</p>
                          <p className="text-xs text-slate-400">{sensorDefaults[type].unit}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
