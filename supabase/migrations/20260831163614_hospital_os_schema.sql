/*
# Hospital OS Resource Management System - Database Schema

This schema models a virtual hospital where Operating System concepts are applied:
- Patients = Processes (with priority, burst time, arrival time)
- Hospital resources = System resources (ICU beds, ventilators, blood units, surgical rooms, staff)
- Resource allocation = Banker's Algorithm for deadlock avoidance
- Patient scheduling = CPU scheduling algorithms (FCFS, SJF, Priority, Round Robin)
- Memory management = Ward/department memory blocks

## Tables

1. `resources` - Hospital resources (ICU beds, ventilators, etc.) with total/available counts
2. `patients` - Patient records acting as processes with scheduling attributes
3. `allocations` - Current resource allocations (which patient holds which resource)
4. `scheduling_results` - Results of scheduling algorithm runs
5. `simulation_logs` - Audit log of all simulation events
6. `memory_blocks` - Memory management blocks for hospital wards/departments

## Security
- Single-tenant app (no auth). RLS enabled with anon+authenticated full CRUD on all tables.
*/

-- Resources table: hospital resources with total and available counts
CREATE TABLE IF NOT EXISTS resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  total int NOT NULL DEFAULT 0 CHECK (total >= 0),
  available int NOT NULL DEFAULT 0 CHECK (available >= 0),
  unit text NOT NULL DEFAULT 'units',
  category text NOT NULL DEFAULT 'general',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Patients table: acts as processes in OS scheduling
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pid int NOT NULL UNIQUE, -- process/patient ID
  name text NOT NULL,
  age int,
  gender text DEFAULT 'unknown',
  condition text NOT NULL DEFAULT 'stable',
  priority int NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10), -- 1=highest, 10=lowest
  arrival_time int NOT NULL DEFAULT 0 CHECK (arrival_time >= 0), -- when patient arrives (ms in sim time)
  burst_time int NOT NULL DEFAULT 1 CHECK (burst_time >= 1), -- treatment duration needed
  waiting_time int DEFAULT 0,
  turnaround_time int DEFAULT 0,
  completion_time int DEFAULT 0,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'running', 'completed', 'admitted', 'discharged')),
  ward text DEFAULT 'general',
  memory_required int DEFAULT 0, -- memory blocks needed (for memory management sim)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Allocations: which patient holds how much of which resource (for Banker's Algorithm)
CREATE TABLE IF NOT EXISTS allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  allocated int NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  max_need int NOT NULL DEFAULT 0 CHECK (max_need >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(patient_id, resource_id)
);

-- Scheduling results: stores results of each scheduling algorithm run
CREATE TABLE IF NOT EXISTS scheduling_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  algorithm text NOT NULL, -- FCFS, SJF, PRIORITY, ROUND_ROBIN
  patient_order jsonb NOT NULL, -- ordered list of patient IDs
  gantt_chart jsonb NOT NULL, -- gantt chart data
  avg_waiting_time numeric NOT NULL DEFAULT 0,
  avg_turnaround_time numeric NOT NULL DEFAULT 0,
  total_time int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Simulation logs: audit trail of all events
CREATE TABLE IF NOT EXISTS simulation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL, -- SCHEDULING, ALLOCATION, DEADLOCK, MEMORY, SYSTEM
  event_message text NOT NULL,
  details jsonb,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'success')),
  created_at timestamptz DEFAULT now()
);

-- Memory blocks: for memory management simulation (ward/department memory)
CREATE TABLE IF NOT EXISTS memory_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id int NOT NULL UNIQUE,
  label text NOT NULL,
  size int NOT NULL CHECK (size >= 0), -- total size of block
  used int NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= size),
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'allocated', 'fragmented')),
  strategy text DEFAULT 'FIRST_FIT', -- allocation strategy used
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_blocks ENABLE ROW LEVEL SECURITY;

-- Policies for resources (single-tenant, anon+authenticated)
DROP POLICY IF EXISTS "anon_crud_resources_s" ON resources;
CREATE POLICY "anon_crud_resources_s" ON resources FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_resources_i" ON resources;
CREATE POLICY "anon_crud_resources_i" ON resources FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_resources_u" ON resources;
CREATE POLICY "anon_crud_resources_u" ON resources FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_resources_d" ON resources;
CREATE POLICY "anon_crud_resources_d" ON resources FOR DELETE TO anon, authenticated USING (true);

-- Policies for patients
DROP POLICY IF EXISTS "anon_crud_patients_s" ON patients;
CREATE POLICY "anon_crud_patients_s" ON patients FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_patients_i" ON patients;
CREATE POLICY "anon_crud_patients_i" ON patients FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_patients_u" ON patients;
CREATE POLICY "anon_crud_patients_u" ON patients FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_patients_d" ON patients;
CREATE POLICY "anon_crud_patients_d" ON patients FOR DELETE TO anon, authenticated USING (true);

-- Policies for allocations
DROP POLICY IF EXISTS "anon_crud_alloc_s" ON allocations;
CREATE POLICY "anon_crud_alloc_s" ON allocations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_alloc_i" ON allocations;
CREATE POLICY "anon_crud_alloc_i" ON allocations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_alloc_u" ON allocations;
CREATE POLICY "anon_crud_alloc_u" ON allocations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_alloc_d" ON allocations;
CREATE POLICY "anon_crud_alloc_d" ON allocations FOR DELETE TO anon, authenticated USING (true);

-- Policies for scheduling_results
DROP POLICY IF EXISTS "anon_crud_sched_s" ON scheduling_results;
CREATE POLICY "anon_crud_sched_s" ON scheduling_results FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_sched_i" ON scheduling_results;
CREATE POLICY "anon_crud_sched_i" ON scheduling_results FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_sched_u" ON scheduling_results;
CREATE POLICY "anon_crud_sched_u" ON scheduling_results FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_sched_d" ON scheduling_results;
CREATE POLICY "anon_crud_sched_d" ON scheduling_results FOR DELETE TO anon, authenticated USING (true);

-- Policies for simulation_logs
DROP POLICY IF EXISTS "anon_crud_logs_s" ON simulation_logs;
CREATE POLICY "anon_crud_logs_s" ON simulation_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_logs_i" ON simulation_logs;
CREATE POLICY "anon_crud_logs_i" ON simulation_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_logs_u" ON simulation_logs;
CREATE POLICY "anon_crud_logs_u" ON simulation_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_logs_d" ON simulation_logs;
CREATE POLICY "anon_crud_logs_d" ON simulation_logs FOR DELETE TO anon, authenticated USING (true);

-- Policies for memory_blocks
DROP POLICY IF EXISTS "anon_crud_mem_s" ON memory_blocks;
CREATE POLICY "anon_crud_mem_s" ON memory_blocks FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_mem_i" ON memory_blocks;
CREATE POLICY "anon_crud_mem_i" ON memory_blocks FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_mem_u" ON memory_blocks;
CREATE POLICY "anon_crud_mem_u" ON memory_blocks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_mem_d" ON memory_blocks;
CREATE POLICY "anon_crud_mem_d" ON memory_blocks FOR DELETE TO anon, authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_pid ON patients(pid);
CREATE INDEX IF NOT EXISTS idx_allocations_patient ON allocations(patient_id);
CREATE INDEX IF NOT EXISTS idx_allocations_resource ON allocations(resource_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON simulation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_type ON simulation_logs(event_type);