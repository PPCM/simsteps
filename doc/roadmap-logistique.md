# Logistics roadmap — vehicles, racks and missing warehouse concepts

SimSteps currently simulates walking pickers only, on uniform racks, with a
single process (outbound picking → drop). This document reviews the gap
against real warehouse terminology and defines a six-phase integration plan.
Each phase is independently shippable and backward compatible (same pattern
as previous evolutions: JSON format + engine + validation + editor + render
+ tests, with normalization on edit).

## 1. Material handling equipment (MHE)

| Vehicle | Use | Speed | Lift | Min aisle | Capacity | Simulation notes |
|---|---|---|---|---|---|---|
| Walking picker (current) | Detail picking | 1.2 m/s | 1.8 m | ~1.2 m | tote/roll | Becomes one agent type among others |
| Hand pallet truck | Ground pallet moves | 1.1 m/s | 0.2 m | 1.8 m | 1 pallet | Slow loaded; ground level only |
| Powered pallet truck | Ground transfers, docks | 1.7–2.5 m/s | 0.2 m | 2.0 m | 1–2 pallets | Loaded/unloaded speeds; cross-docking workhorse |
| Stacker | Low/medium storage | 1.5 m/s | 4–6 m | 2.3 m | 1 pallet | Lift time ∝ target level height |
| Counterbalance forklift | Versatile, docks, outdoor | 3–4 m/s | 4–7 m | 3.5–4 m | 1 pallet | Fast but wide: excluded from narrow aisles |
| Reach truck | High-bay racking | 2.5 m/s | 10–12 m | 2.7–3 m | 1 pallet | The reference rack-storage vehicle |
| VNA turret truck | Very narrow aisles | 2 m/s | 12–15 m | 1.6–1.9 m | 1 pallet | Guided: one vehicle per aisle, no crossing |
| Order picker (low/high) | Picking at height | 2 m/s | up to 10 m | 1.8–2.5 m | rolls/cartons | Operator lifts with the load: pick time ∝ level |
| Tow tractor (milk-run) | Inter-zone rounds | 2–3 m/s | — | 2.5 m | 3–5 trailers | Cyclic planned rounds rather than missions |
| AGV / AMR | Automated transfers, goods-to-person | 1–2 m/s | 0–0.5 m | 1.2–1.5 m | 1 pallet/shelf | No breaks; fleet management, charging |

Engine implications:
- **Typed agents**: the current "operator" becomes an agent with a vehicle
  profile — loaded/unloaded speed, capacity, lift height, required aisle
  width, fixed pallet pick/drop times.
- **Gauge-filtered routing**: edges of the circulation graph carry the lane
  width (aisles and corridors already have one); A* only uses edges
  compatible with the agent's gauge.
- **Fleet in the scenario**: `operators: 5` becomes
  `fleet: { pieton: 4, retractable: 2, … }` (legacy field = 100 % walkers).
- **Compatible assignment**: missions only go to agents able to reach the
  required levels.
- **Per-type KPIs**: utilization, distance and missions per vehicle family;
  A/B comparison answers "2 reach trucks + 3 walkers vs 5 walkers?".

## 2. Racks

Current model: `rack { id, aisle, side, levels }`, uniform height, depth
fixed. Target characteristics: levels **with level height** (pick time and
required vehicle depend on the level), overall height bounded by the
building's clear height, adjustable depth (single/double deep), explicit bay
width, level roles (low = picking, high = reserve). Rack typology to add
over time: selective pallet racking (current implicit), light shelving,
gravity flow (FIFO), drive-in/push-back (LIFO accumulation), cantilever.
Priority: dimensions and levels first; typology once replenishment exists.

## 3. Missing warehouse concepts

Zones and infrastructure: docks with doors and scheduled trucks, **buffer /
drop zone** (« zone tampon » : picked goods staged next to the packing
workshops, decoupling picking pace from packing pace — implies a packer
role distinct from the picker), staging / consolidation area (bounded
capacity), block stacking, cross-docking, charging area, obstacles
(columns, offices), conveyors/sorter, mezzanine.

Missing characteristics on existing objects: building clear height; aisle
one-way flag, dedicated vehicle (VNA), served levels; corridor one-way /
pedestrian vs vehicle lanes / speed limits; zone capacities and processing
times; operator shifts and breaks; **SKUs with ABC rotation classes**
(currently lines hit uniformly random slots — slotting is the logistician's
lever #1 and cannot be shown yet); inbound processes (receiving → putaway,
replenishment, inventory, returns); congestion/waiting/service-level/fill
KPIs.

## 4. Six-phase plan

1. **Parametric racks** (foundation) — **done (v0.4.x)**: per-rack
   `levelHeight` (default 2 m) and `depth` (default 1.4 m), optional
   building clear height (`dimensions.height`) bounding rack heights,
   pick time by level (`liftTimePerLevelSec` scenario parameter), real
   heights with level beams in the 3D render, rack fields on the aisle
   panel (racks stay aisle-derived; the `type` field is deferred to the
   typology work alongside replenishment).
2. **Vehicle fleet** (core) — profile catalog, `fleet` scenario field,
   gauge-filtered A*, compatible assignment, loaded/unloaded speeds, simple
   3D silhouettes, per-type KPIs.
3. **SKUs & slotting** — ABC rotation classes, order lines drawn by
   rotation (80/15/5), slotting strategies (random / by class near docks /
   imported), distance-per-line KPI.
4. **Inbound flows and process zones** — docks with N doors, scheduled
   trucks, putaway missions, threshold-based replenishment reserve →
   picking, buffer/drop zones feeding the packing workshops (pickers drop
   there, packers consume — two decoupled agent roles), staging with
   capacity.
5. **Advanced circulation** — one-way lanes (graph already supports
   `oneWay`), pedestrian vs vehicle lanes, edge capacity and queues, VNA
   exclusivity, obstacles.
6. **Automation** — AGV/AMR with charging, conveyors as fixed-throughput
   edges, goods-to-person strategies, mezzanines.

Recommended sequence: 1 → 2 → 3 form the value core (realistic racks, mixed
fleet, slotting); 4–6 add operational realism and can be re-prioritized.
