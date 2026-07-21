# Post-Mortem: RabbitMQ Message Spike — 1. Juli 2026

**Instanz:** [myrtle-magenta-gull.rmq6.cloudamqp.com](https://myrtle-magenta-gull.rmq6.cloudamqp.com/)  
**Zeitraum:** 00:45–03:00 CEST  
**Status:** Untersucht, keine akuten Backlogs — Ursachen teilweise identifiziert, weitere Klärung nötig

---

## Zusammenfassung

In der Nacht vom 1. Juli 2026 kam es ab ca. **00:45 CEST** zu einer Serie von Message-Peaks auf dem CloudAMQP-Cluster. Es handelte sich **nicht um einen einzelnen Spike um 01:00**, sondern um **mehrere aufeinanderfolgende Wellen** über ca. 2,5 Stunden, mit einem zusätzlichen großen Batch um **02:05 CEST**.

**Gesamtvolumen im Zeitfenster 00:30–03:00 CEST: ~2,2 Mio. Messages** (Publish).

Aktuell keine kritischen Backlogs auf den betroffenen Vhosts — die Wellen wurden offenbar verarbeitet.

---

## Timeline

| Zeit (CEST) | Rate (global) | Messages (5-Min-Bucket) | Hauptverursacher |
|---|---|---|---|
| **00:45** | 2.553/s | 766.017 | `admin-center` (79%) |
| **01:15** | 2.054/s | 616.065 | `hectorone` (48%), `admin-center` (35%) |
| **01:45** | 1.378/s | 413.275 | `hectorone` (78%), `mygym` (22%) |
| **02:05** | — | ~1.640.000 | `MembershipEvents`-Batch über 44 Tenants |
| **02:15** | 941/s | 282.241 | `hectorone` (65%), `admin-center` (35%) |
| **02:45** | 227/s | 68.056 | Auslaufende Aktivität |

---

## Betroffene Vhosts & Queues

### Welle 1 — 00:45 CEST (`admin-center`)

| Vhost | Anteil | Messages |
|---|---|---|
| **admin-center** | 79% | 469.266 |
| hectorone | 13% | 75.270 |
| mygym | 4% | 21.823 |
| diverse Tenants | 4% | ~23.000 |

- Queue-Tiefe in `admin-center` stieg kurzzeitig um **~888.000 Messages** (00:40 CEST), wurde aber wieder abgebaut (aktuell: 15 Messages im Vhost).
- Auf **Queue-Ebene** kaum sichtbare Aktivität → Traffic läuft über **Exchanges/Federation**, nicht direkt in einzelne Queues.
- Relevante Infrastruktur: `ac.event-collector:*`, Federation-Exchanges (`global_events`, `entrecode_events`).

### Welle 2+3 — 01:15 & 01:45 CEST (`hectorone` / `mygym`)

- `hectorone` übernimmt als Hauptquelle (~48–78%).
- `mygym` als zweitgrößter Tenant-Beteiligter (~17–22%).
- Vermutlich Event-Propagation aus dem Hector-Ökosystem.

### Welle 4 — 02:05 CEST (`MembershipEvents`-Batch)

**44 Tenant-Vhosts** erhielten gleichzeitig `MembershipEvents`:

| Vhost | Messages |
|---|---|
| **vc5020** | 964.040 |
| ebrn | 279.641 |
| bfalt | 89.015 |
| qfdsn | 65.575 |
| bdtblg | 53.030 |
| + 39 weitere | … |

**Gesamt: ~1,64 Mio. MembershipEvents**

Betroffene Queue-Patterns:

- `DsbConnectService:Hector.ReadOnlyDataModel.MembershipEvents`
- `CheckinOutService.MembershipEvents`
- `EgymCloudConnector.MembershipEvents`

→ Sieht nach einem **geplanten Batch-Replay / Nacht-Sync** aus, nicht nach einem Fehler.

---

## Impact

- **Kein dauerhafter Schaden:** Keine kritischen Backlogs auf den Spike-Vhosts.
- **Kurzzeitige Lastspitze** auf dem Broker (~2.500 Messages/s global).
- Einige Tenant-Queues haben **ältere, unverarbeitete Messages** (`flgnm`, `vc5020`, `tfl`, `ebrn`) — nicht direkt vom heutigen Spike verursacht, aber separat prüfen.

---

## Was wir wissen / Was noch offen ist

| Bereich | Status | Details |
|---|---|---|
| MembershipEvents-Batch 02:05 | **Wahrscheinlich erklärt** | Geplanter Job, 44 Tenants, ~1,64 Mio. Messages |
| admin-center Spike 00:45 | **Offen** | 469k Messages über Federation/Exchanges — kein einzelner Queue-Verursacher identifiziert |
| hectorone Wellen 01:15–01:45 | **Offen** | Vhost-Level-Aktivität klar, aber kein konkreter Upstream/Service benannt |
| Ob erwartetes Verhalten | **Unklar** | Zeitfenster (kurz nach Mitternacht) deutet auf Cron/Scheduled Jobs hin |

---

## Empfohlene nächste Schritte fürs Team

1. **MembershipEvents-Job identifizieren** — Welcher Service/Cron triggert den Batch um ~02:05 CEST? Ist das erwartet?
2. **admin-center Event-Collector untersuchen** — Was hat um 00:45 CEST ~469k Messages über Federation geschickt? Logs von `ac.event-collector:entrecode-events-forwarder` und `ac.event-collector:global-events-log` prüfen.
3. **hectorone Upstream klären** — Welcher Publisher sendet um 01:15/01:45 über den `hectorone`-Exchange?
4. **Geplante Nacht-Jobs inventarisieren** — Gibt es Cronjobs zwischen 00:00–03:00 CEST, die zusammenlaufen könnten?
5. **Alte Backlogs separat triagieren** — Queues mit dauerhaft hoher Tiefe (`flgnm`: 4.662, `vc5020`: 2.158, `tfl`: 3.456) unabhängig vom Spike prüfen.

---

## Datenquelle

Analyse via RabbitMQ Management API (5-Minuten-Buckets, 24h Retention). Vhost-Level-Stats und Queue-Level-Stats (letzteres bestätigt: Spike-Traffic primär auf Exchange/Federation-Ebene, nicht auf einzelnen Queues sichtbar).
