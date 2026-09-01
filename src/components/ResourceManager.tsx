import { useState, useEffect } from 'react'
import { Stethoscope, ShieldCheck, ShieldAlert, Plus, Minus, Save, RotateCcw, Activity, AlertTriangle } from 'lucide-react'
import { Resource, Patient, Sensor, Allocation, triageConfig } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { bankersAlgorithm, BankerResult } from '../lib/simulation'

interface Props {
  resources: Resource[]
  patients: Patient[]
  sensors: Sensor[]
  onRefresh: () => void
}

export default function ResourceManager({ resources, patients, sensors, onRefresh }: Props) {
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [loading, setLoading] = useState(true)
  const [bankerResult, setBankerResult] = useState<BankerResult | null>(null)
  const [running, setRunning] = useState(false)
  const [showAllocForm, setShowAllocForm] = useState(false)
  const [form, setForm] = useState({ patientId: '', resourceId: '', allocated: 0, maxNeed: 0 })

  useEffect(() => {
    fetchAllocations()
  }, [])

  async function fetchAllocations() {
    setLoading(true)
    const { data } = await supabase.from('allocations').select('*')
    setAllocations(data || [])
    setLoading(false)
  }

  // Auto-suggest allocations based on triage level
  const redPatients = patients.filter((p) => p.triage_level === 'red')
  const yellowPatients = patients.filter((p) => p.triage_level === 'yellow')

  async function autoAllocate() {
    setRunning(true)
    // For each red patient, ensure they have ICU bed + ventilator allocations
    for (const p of redPatients) {
      const icuResource = resources.find((r) => r.name === 'ICU Beds')
      const ventResource = resources.find((r) => r.name === 'Ventilators')
      const nurseResource = resources.find((r) => r.name === 'Nurses')
      const doctorResource = resources.find((r) => r.name === 'Doctors')

      const patientSensors = sensors.filter((s) => s.patient_id === p.id)
      const hasSpO2Alert = patientSensors.some((s) => s.type === 'spo2' && s.status === 'alert')
      const hasHrAlert = patientSensors.some((s) => s.type === 'heart_rate' && s.status === 'alert')

      if (icuResource) {
        const existing = allocations.find((a) => a.patient_id === p.id && a.resource_id === icuResource.id)
        if (!existing) {
          await supabase.from('allocations').insert({
            patient_id: p.id, resource_id: icuResource.id, allocated: 1, max_need: 2,
          })
        }
      }
      if (ventResource && (hasSpO2Alert || hasHrAlert)) {
        const existing = allocations.find((a) => a.patient_id === p.id && a.resource_id === ventResource.id)
        if (!existing) {
          await supabase.from('allocations').insert({
            patient_id: p.id, resource_id: ventResource.id, allocated: 1, max_need: 2,
          })
        }
      }
      if (nurseResource) {
        const existing = allocations.find((a) => a.patient_id === p.id && a.resource_id === nurseResource.id)
        if (!existing) {
          await supabase.from('allocations').insert({
            patient_id: p.id, resource_id: nurseResource.id, allocated: 2, max_need: 3,
          })
        }
      }
      if (doctorResource) {
        const existing = allocations.find((a) => a.patient_id === p.id && a.resource_id === doctorResource.id)
        if (!existing) {
          await supabase.from('allocations').insert({
            patient_id: p.id, resource_id: doctorResource.id, allocated: 1, max_need: 1,
          })
        }
      }
    }

    // For yellow patients, ensure ward bed + nurse
    for (const p of yellowPatients) {
      const wardResource = resources.find((r) => r.name === 'Ward Beds')
      const nurseResource = resources.find((r) => r.name === 'Nurses')
      if (wardResource) {
        const existing = allocations.find((a) => a.patient_id === p.id && a.resource_id === wardResource.id)
        if (!existing) {
          await supabase.from('allocations').insert({
            patient_id: p.id, resource_id: wardResource.id, allocated: 1, max_need: 1,
          })
        }
      }
      if (nurseResource) {
        const existing = allocations.find((a) => a.patient_id === p.id && a.resource_id === nurseResource.id)
        if (!existing) {
          await supabase.from('allocations').insert({
            patient_id: p.id, resource_id: nurseResource.id, allocated: 1, max_need: 2,
          })
        }
      }
    }

    // Recalculate availability
    const { data: allAllocs } = await supabase.from('allocations').select('resource_id, allocated')
    for (const r of resources) {
      const totalAllocated = (allAllocs || []).filter((a: any) => a.resource_id === r.id).reduce((s: number, a: any) => s + a.allocated, 0)
      await supabase.from('resources').update({ available: Math.max(0, r.total - totalAllocated), updated_at: new Date().toISOString() }).eq('id', r.id)
    }

    await supabase.from('simulation_logs').insert({
      event_type: 'ALLOCATION',
      event_message: `Auto-allocation complete: ${redPatients.length} critical + ${yellowPatients.length} serious patients processed`,
      severity: 'success',
      details: { red: redPatients.length, yellow: yellowPatients.length },
    })

    await fetchAllocations()
    onRefresh()
    setRunning(false)
  }

  async function runBankers() {
    setRunning(true)
    const { data: resData } = await supabase.from('resources').select('*')
    const { data: allocData } = await supabase.from('allocations').select('*')

    const bankerResources = (resData || []).map((r: any) => ({ id: r.id, name: r.name, total: r.total, available: r.available }))
    const bankerAllocations = (allocData || []).map((a: any) => {
      const patient = patients.find((p) => p.id === a.patient_id)
      return {
        patient_id: a.patient_id,
        patient_name: patient?.name || 'Unknown',
        patient_pid: patient?.pid || 0,
        resource_id: a.resource_id,
        allocated: a.allocated,
        max_need: a.max_need,
      }
    })

    const result = bankersAlgorithm(bankerResources, bankerAllocations)
    setBankerResult(result)

    await supabase.from('simulation_logs').insert({
      event_type: 'DEADLOCK',
      event_message: result.message,
      severity: result.safe ? 'success' : 'error',
      details: { safe: result.safe, safeSequence: result.safeSequence },
    })

    onRefresh()
    setRunning(false)
  }

  async function saveAllocation() {
    if (!form.patientId || !form.resourceId || form.maxNeed < form.allocated) return
    const existing = allocations.find((a) => a.patient_id === form.patientId && a.resource_id === form.resourceId)
    if (existing) {
      await supabase.from('allocations').update({ allocated: form.allocated, max_need: form.maxNeed, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      await supabase.from('allocations').insert({ patient_id: form.patientId, resource_id: form.resourceId, allocated: form.allocated, max_need: form.maxNeed })
    }
    // Recalculate availability
    const resource = resources.find((r) => r.id === form.resourceId)
    if (resource) {
      const totalAllocated = allocations.filter((a) => a.resource_id === resource.id && a.patient_id !== form.patientId).reduce((s, a) => s + a.allocated, 0) + form.allocated
      await supabase.from('resources').update({ available: Math.max(0, resource.total - totalAllocated), updated_at: new Date().toISOString() }).eq('id', resource.id)
    }
    const patient = patients.find((p) => p.id === form.patientId)
    await supabase.from('simulation_logs').insert({
      event_type: 'ALLOCATION',
      event_message: `Manual allocation: ${form.allocated} units to ${patient?.name}`,
      severity: 'info',
    })
    setForm({ patientId: '', resourceId: '', allocated: 0, maxNeed: 0 })
    setShowAllocForm(false)
    fetchAllocations()
    onRefresh()
  }

  async function removeAllocation(id: string) {
    const alloc = allocations.find((a) => a.id === id)
    if (!alloc) return
    await supabase.from('allocations').delete().eq('id', id)
    const resource = resources.find((r) => r.id === alloc.resource_id)
    if (resource) {
      const remaining = allocations.filter((a) => a.resource_id === resource.id && a.id !== id).reduce((s, a) => s + a.allocated, 0)
      await supabase.from('resources').update({ available: Math.max(0, resource.total - remaining), updated_at: new Date().toISOString() }).eq('id', resource.id)
    }
    fetchAllocations()
    onRefresh()
  }

  async function resetAll() {
    for (const a of allocations) {
      await supabase.from('allocations').delete().eq('id', a.id)
    }
    for (const r of resources) {
      await supabase.from('resources').update({ available: r.total, updated_at: new Date().toISOString() }).eq('id', r.id)
    }
    setBankerResult(null)
    fetchAllocations()
    onRefresh()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const totalResources = resources.reduce((s, r) => s + r.total, 0)
  const availableResources = resources.reduce((s, r) => s + r.available, 0)
  const utilization = totalResources > 0 ? ((1 - availableResources / totalResources) * 100).toFixed(0) : '0'

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="card p-6 bg-gradient-to-br from-slate-50 to-primary-50/30">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Stethoscope className="w-5 h-5 text-primary-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-slate-800">Resource Allocation — Sensor-Driven</h3>
            <p className="text-sm text-slate-600 mt-1">
              When a patient's sensor readings cross into critical territory, the system auto-allocates hospital resources (ICU beds, ventilators, staff) using the Banker's Algorithm to guarantee no deadlock. The algorithm checks that granting resources leaves the hospital in a safe state — where every patient can eventually complete treatment.
            </p>
            <div className="flex gap-3 mt-4">
              <button onClick={autoAllocate} disabled={running} className="btn-primary">
                <Activity className="w-4 h-4" />
                {running ? 'Processing...' : 'Auto-Allocate from Triage'}
              </button>
              <button onClick={runBankers} disabled={running} className="btn-success">
                <ShieldCheck className="w-4 h-4" />
                Run Safety Check
              </button>
              <button onClick={() => setShowAllocForm(true)} className="btn-secondary">
                <Plus className="w-4 h-4" />
                Manual Allocate
              </button>
              <button onClick={resetAll} className="btn-secondary">
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Resource Pool */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {resources.map((r) => {
          const usedPct = r.total > 0 ? ((r.total - r.available) / r.total) * 100 : 0
          return (
            <div key={r.id} className="card p-4">
              <p className="text-sm font-medium text-slate-700">{r.name}</p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-bold text-slate-800">{r.available}</span>
                <span className="text-xs text-slate-400">/ {r.total} {r.unit}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
                <div className={`h-full rounded-full transition-all duration-500 ${usedPct > 80 ? 'bg-error-500' : usedPct > 50 ? 'bg-warning-500' : 'bg-success-500'}`} style={{ width: `${usedPct}%` }} />
              </div>
              <p className="text-xs text-slate-400 mt-1">{usedPct.toFixed(0)}% in use</p>
            </div>
          )
        })}
      </div>

      {/* Banker's Result */}
      {bankerResult && (
        <div className={`card p-6 animate-slide-up ${bankerResult.safe ? 'border-success-300 bg-success-50/30' : 'border-error-300 bg-error-50/30'}`}>
          <div className="flex items-center gap-3 mb-4">
            {bankerResult.safe ? <ShieldCheck className="w-8 h-8 text-success-500" /> : <ShieldAlert className="w-8 h-8 text-error-500" />}
            <div>
              <h3 className="text-lg font-bold text-slate-800">Banker's Algorithm — Safety Analysis</h3>
              <p className={`text-sm font-medium ${bankerResult.safe ? 'text-success-700' : 'text-error-700'}`}>{bankerResult.message}</p>
            </div>
          </div>

          {bankerResult.safe && bankerResult.safeSequence.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-slate-600 mb-2">Safe Treatment Sequence:</p>
              <div className="flex items-center gap-2 flex-wrap">
                {bankerResult.safeSequence.map((name, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="px-3 py-1.5 bg-success-100 text-success-700 rounded-lg text-sm font-medium">{name}</span>
                    {i < bankerResult.safeSequence.length - 1 && <span className="text-slate-400">→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {bankerResult.steps.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">Execution Steps:</p>
              <div className="space-y-2">
                {bankerResult.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200/60">
                    <span className="w-6 h-6 bg-primary-100 text-primary-700 rounded-lg inline-flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    <span className="text-sm text-slate-700 font-medium">{step.patientName}</span>
                    <span className="text-xs text-slate-400">completes, resources released</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Allocations Table */}
      <div className="card p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Current Allocations</h3>
        {allocations.length === 0 ? (
          <div className="text-center py-8">
            <AlertTriangle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No allocations yet. Click "Auto-Allocate from Triage" to assign resources based on patient sensor data.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-600">Patient</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600">Triage</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600">Resource</th>
                  <th className="text-center py-3 px-4 font-semibold text-slate-600">Allocated</th>
                  <th className="text-center py-3 px-4 font-semibold text-slate-600">Max Need</th>
                  <th className="text-center py-3 px-4 font-semibold text-slate-600">Remaining</th>
                  <th className="text-center py-3 px-4 font-semibold text-slate-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => {
                  const patient = patients.find((p) => p.id === a.patient_id)
                  const resource = resources.find((r) => r.id === a.resource_id)
                  const triage = patient ? triageConfig[patient.triage_level as keyof typeof triageConfig] || triageConfig.green : triageConfig.green
                  const remaining = a.max_need - a.allocated
                  return (
                    <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 text-slate-800">{patient?.name || 'Unknown'}</td>
                      <td className="py-3 px-4"><span className={`badge ${triage.bg} ${triage.text}`}>{triage.label}</span></td>
                      <td className="py-3 px-4 text-slate-700">{resource?.name || 'Unknown'}</td>
                      <td className="py-3 px-4 text-center font-mono text-slate-600">{a.allocated}</td>
                      <td className="py-3 px-4 text-center font-mono text-slate-600">{a.max_need}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`badge ${remaining > 0 ? 'bg-warning-100 text-warning-700' : 'bg-success-100 text-success-700'}`}>{remaining}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button onClick={() => removeAllocation(a.id)} className="text-error-500 hover:text-error-600"><Minus className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Allocation Modal */}
      {showAllocForm && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50" onClick={() => setShowAllocForm(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-4">Manual Resource Allocation</h3>
            <div className="space-y-4">
              <div>
                <label className="label">Patient</label>
                <select className="input" value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })}>
                  <option value="">Select patient...</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.name} (PID {p.pid})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Resource</label>
                <select className="input" value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
                  <option value="">Select resource...</option>
                  {resources.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.available} available)</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Allocated</label>
                  <input type="number" min={0} className="input" value={form.allocated} onChange={(e) => setForm({ ...form, allocated: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="label">Max Need</label>
                  <input type="number" min={0} className="input" value={form.maxNeed} onChange={(e) => setForm({ ...form, maxNeed: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={saveAllocation} disabled={!form.patientId || !form.resourceId || form.maxNeed < form.allocated} className="btn-primary flex-1">
                <Save className="w-4 h-4" /> Save
              </button>
              <button onClick={() => setShowAllocForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
