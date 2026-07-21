# RabbitMQ Backlog-Analyse — 21. Juli 2026

**Instanz:** [myrtle-magenta-gull.rmq6.cloudamqp.com](https://myrtle-magenta-gull.rmq6.cloudamqp.com/)  
**Zeitpunkt:** 21.07.2026, ~09:00 CEST  
**Status:** ~99.000 unverarbeitete Messages, 244 von 248 betroffenen Queues ohne Consumer  
**Datenquelle:** RabbitMQ Management API (UI unresponsive wegen 17.895 Queues / vielen Vhosts)

---

## Zusammenfassung

Auf dem CloudAMQP-Cluster liegen **99.074 Messages** in **248 Queues** (von 17.895 gesamt). Davon haben **244 Queues keinen einzigen Consumer** — die Services, die diese Events konsumieren sollten, laufen nicht oder sind nicht verbunden.

RabbitMQ ist kein Datenspeicher. Messages sollten in Millisekunden bis Sekunden verarbeitet werden. Die ältesten Events stammen von **Mai/Juni 2026** — sie stauen sich seit Wochen.

**85 % des Backlogs** verteilen sich auf drei Queue-Patterns:


| #   | Queue-Pattern                               | Messages | Queues | Vhosts | Consumer      |
| --- | ------------------------------------------- | -------- | ------ | ------ | ------------- |
| 1   | `appsite-backend.course-management-service` | 49.772   | 43     | 43     | **0 überall** |
| 2   | `HansefitCloudConnector.CheckinOutEvents`   | 34.694   | 10     | 10     | **0 überall** |
| 3   | `DsbConnectService:*` (Events + Errors)     | 12.542   | 156    | ~50    | **0 überall** |


Vollständige Queue-Liste: `[rabbitmq-backlog-analysis-2026-07-21.json](rabbitmq-backlog-analysis-2026-07-21.json)`

---

## Cluster-Übersicht


| Metrik                                  | Wert                           |
| --------------------------------------- | ------------------------------ |
| Messages gesamt                         | 99.074 (99.068 ready, 6 unack) |
| Queues gesamt                           | 17.895                         |
| Queues mit Messages                     | 248                            |
| Queues ohne Consumer (bei Messages > 0) | 244 (98 %)                     |
| Aktive Connections                      | 3.428                          |
| Aktive Consumers (gesamt)               | 18.615                         |


---

## 1. `appsite-backend.course-management-service` — 49.772 Messages

**Owner:** Appsite-Backend / CourseManagementService  
**Event-Typen:** `AppointmentCancelledEvent`, Kurs-Termin-Events  
**Älteste Messages:** 22.–23. Juni 2026 (~4 Wochen alt)  
**Consumer:** 0 auf allen 43 Vhosts

### Betroffene Vhosts

`attmrh, bdebrg, bdtblg, bfalt, bsnmr, btsfts, bvhrh, cfb, cvbvn, dany, eabd, ebrn, efhdlm, efu, enk, fcn, gzp, idt, ijyanh, inykmz, mgbsgg, mggrh, mghln, mgknrt, mglwre, mgmti, mgohz, mgphn, mgpka, mgplnz, mgpson, mgslb, mgsnh, mgspl, mgstl, mgztz, mygym, qfdsn, rdg, rlxbcm, tfl, vc5020, vwlm`

### Top-Queues


| Vhost  | Messages |
| ------ | -------- |
| ebrn   | 7.311    |
| vc5020 | 6.770    |
| cfb    | 5.426    |
| mygym  | 3.453    |
| dany   | 3.357    |
| rlxbcm | 2.926    |
| eabd   | 2.689    |
| bfalt  | 2.577    |
| btsfts | 839      |
| vwlm   | 1.406    |


### Beispiel-Message

```json
{
  "appointmentId": 50004214,
  "customerId": 506616,
  "status": "Deleted",
  "eventClubId": "EBRN",
  "eventSource": "CourseManagementService",
  "eventType": "AppointmentCancelledEvent",
  "eventOccuredAt": "2026-06-23T11:33:03.573+02:00"
}
```

**→ Action:** Warum läuft der Consumer auf 43 Tenants nicht? Service deployen oder Queue-Bindings entfernen.

---

## 2. `HansefitCloudConnector.CheckinOutEvents` — 34.694 Messages

**Owner:** HansefitCloudConnector / CheckinOutService  
**Event-Typen:** `CustomerCheckedInEvent`  
**Älteste Messages:** 15. Juli 2026 (~6 Tage alt)  
**Consumer:** 0 auf allen 10 Vhosts

### Betroffene Vhosts

`bdebrg, bdtblg, bfalt, bsnmr, inykmz, mglwre, mgphn, mgpka, rdg, vd`

### Top-Queues


| Vhost  | Messages |
| ------ | -------- |
| bfalt  | 11.981   |
| vd     | 6.875    |
| bsnmr  | 4.701    |
| bdebrg | 4.601    |
| bdtblg | 2.436    |
| rdg    | 1.082    |
| inykmz | 1.049    |
| mgpka  | 851      |
| mgphn  | 558      |
| mglwre | 560      |


### Beispiel-Message

```json
{
  "customerId": 22664,
  "studioNumber": 1,
  "checkedIn": "2026-07-15T06:58:28",
  "eventClubId": "BFALT",
  "eventSource": "CheckinOutService",
  "eventType": "CustomerCheckedInEvent",
  "eventOccuredAt": "2026-07-15T08:58:28.943+02:00"
}
```

**→ Action:** Ist Hansefit auf diesen 10 Tenants aktiv? Wenn nein: Bindings entfernen. Wenn ja: HansefitCloudConnector deployen/restarten.

---

## 3. `DsbConnectService:*` — 12.542 Messages

**Owner:** DsbConnectService (Hector ReadOnlyDataModel)  
**Consumer:** 0 auf allen betroffenen Queues

### Aufschlüsselung nach Event-Typ


| Sub-Pattern               | Messages | Queues  | Vhosts  |
| ------------------------- | -------- | ------- | ------- |
| `CustomerEvents`          | 3.848    | 9       | 9       |
| `CheckinOutEvents.errors` | 3.075    | 81      | 50      |
| `CheckinOutEvents`        | 3.056    | 8       | 8       |
| `AccountingEvents`        | 1.295    | 8       | 8       |
| `MembershipEvents`        | 1.159    | 9       | 9       |
| `CustomerEvents.errors`   | 86       | 24      | 14      |
| weitere `.errors`         | ~23      | diverse | diverse |


**Älteste CustomerEvents:** 28. Mai 2026 (~2 Monate alt)

### Top-Queues


| Vhost  | Queue                                | Messages |
| ------ | ------------------------------------ | -------- |
| flgnm  | `DsbConnectService:CustomerEvents`   | 3.407    |
| flgnm  | `DsbConnectService:CheckinOutEvents` | 812      |
| flgnm  | `DsbConnectService:AccountingEvents` | 555      |
| flgnm  | `DsbConnectService:MembershipEvents` | 433      |
| inykmz | `CheckinOutEvents.errors`            | 541      |
| jbrr   | `DsbConnectService:CheckinOutEvents` | 723      |


**→ Action:** Mix aus fehlenden Consumern und Error-Queues ohne Monitoring. Error-Queues brauchen Alerting + regelmäßiges Reprocessing oder Purging.

---

## 4. Error-Queues — 3.591 Messages in 142 Queues


| Queue                              | Messages | Vhost               |
| ---------------------------------- | -------- | ------------------- |
| `CheckinOutEvents.errors`          | 541      | inykmz              |
| `hectorone-events-receiver.errors` | 275      | hectorone           |
| `CheckinOutEvents.errors`          | 219      | mgstl               |
| `CheckinOutEvents.errors`          | 199      | mgpson              |
| `CheckinOutEvents.errors`          | 142      | rdg                 |
| `CheckinOutEvents.errors`          | 135      | rlxbcm              |
| `event-collector.errors`           | 89       | diverse (11 Vhosts) |


**→ Action:** Error-Queues ohne Monitoring werden vergessen. Alerting einrichten oder regelmäßig purgen.

---

## 5. `admin-center` Vhost — 924 Messages


| Queue                                                    | Messages | Consumers |
| -------------------------------------------------------- | -------- | --------- |
| `event-collector:..entrecode_events`                     | 776      | **0**     |
| `event-collector:gympluslangenrohr.MMZ.entrecode_events` | 118      | **0**     |
| `ac.event-collector:entrecode-events-forwarder.errors`   | 25       | **0**     |
| `ac.event-collector:global-events-log`                   | 2        | 10 ✓      |
| `event-collector:mygymde.OHZ.entrecode_events`           | 1        | 1 ✓       |
| `event-collector:mygymprime.YEY.entrecode_events`        | 1        | 1 ✓       |


**→ Action:** Event-Collector-Queues ohne Consumer prüfen — Forwarder läuft nicht?

---

## Vollständige Top-30 Queue-Liste


| Messages | Vhost        | Queue                                     | Consumers |
| -------- | ------------ | ----------------------------------------- | --------- |
| 11.981   | bfalt        | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 7.311    | ebrn         | appsite-backend.course-management-service | 0         |
| 6.875    | vd           | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 6.770    | vc5020       | appsite-backend.course-management-service | 0         |
| 5.426    | cfb          | appsite-backend.course-management-service | 0         |
| 4.701    | bsnmr        | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 4.601    | bdebrg       | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 3.453    | mygym        | appsite-backend.course-management-service | 0         |
| 3.407    | flgnm        | DsbConnectService:CustomerEvents          | 0         |
| 3.357    | dany         | appsite-backend.course-management-service | 0         |
| 2.926    | rlxbcm       | appsite-backend.course-management-service | 0         |
| 2.689    | eabd         | appsite-backend.course-management-service | 0         |
| 2.577    | bfalt        | appsite-backend.course-management-service | 0         |
| 2.436    | bdtblg       | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 1.406    | vwlm         | appsite-backend.course-management-service | 0         |
| 1.373    | bsnmr        | appsite-backend.course-management-service | 0         |
| 1.372    | bdebrg       | appsite-backend.course-management-service | 0         |
| 1.145    | mggrh        | appsite-backend.course-management-service | 0         |
| 1.131    | enk          | appsite-backend.course-management-service | 0         |
| 1.082    | rdg          | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 1.049    | inykmz       | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 1.007    | idt          | appsite-backend.course-management-service | 0         |
| 858      | mgpson       | appsite-backend.course-management-service | 0         |
| 851      | mgpka        | HansefitCloudConnector.CheckinOutEvents   | 0         |
| 839      | btsfts       | appsite-backend.course-management-service | 0         |
| 812      | flgnm        | DsbConnectService:CheckinOutEvents        | 0         |
| 776      | admin-center | event-collector:..entrecode_events        | 0         |
| 775      | mgbsgg       | appsite-backend.course-management-service | 0         |
| 723      | jbrr         | DsbConnectService:CheckinOutEvents        | 0         |
| 696      | attmrh       | appsite-backend.course-management-service | 0         |


---

## Vhost-Aggregation (alle Vhosts mit Messages)


| Vhost               | Messages   | Queues | ohne Consumer |
| ------------------- | ---------- | ------ | ------------- |
| bfalt               | 14.558     | 2      | 2             |
| ebrn                | 7.385      | 6      | 6             |
| vc5020              | 6.911      | 5      | 5             |
| vd                  | 6.878      | 2      | 2             |
| bsnmr               | 6.077      | 3      | 3             |
| bdebrg              | 5.979      | 4      | 4             |
| cfb                 | 5.468      | 3      | 3             |
| flgnm               | 5.214      | 5      | 5             |
| mygym               | 3.501      | 27     | 27            |
| dany                | 3.383      | 3      | 3             |
| rlxbcm              | 3.063      | 4      | 4             |
| bdtblg              | 2.717      | 6      | 6             |
| eabd                | 2.714      | 2      | 2             |
| inykmz              | 2.009      | 5      | 5             |
| admin-center        | 924        | 7      | 4             |
| hectorone           | 275        | 1      | 1             |
| + 49 weitere Vhosts | < 1.500 je | …      | …             |


---

## Architektur: RabbitMQ ist kein Datenspeicher

RabbitMQ ist ein **Message Broker** — ein kurzzeitiger Puffer zwischen Producer und Consumer. Das Modell ist:

```
Publish → Queue (kurz) → Consume → Ack → weg
```

Messages sollen **so schnell wie möglich weiterverarbeitet** werden, nicht dauerhaft liegen bleiben. Wenn eine Queue über Tage oder Wochen wächst, ist das ein **Betriebs- oder Architekturproblem**, kein normales Verhalten.


| Normal                      | Aktuell auf dem Cluster        |
| --------------------------- | ------------------------------ |
| Queue-Tiefe ≈ 0             | 99.074 Messages                |
| Consumer aktiv              | 244 Queues mit **0 Consumers** |
| Events kurzlebig (Sekunden) | Events **4–8 Wochen** alt      |


### Sollte man Queues ohne Consumer betreiben?

**Nein — nicht als Dauerzustand.**


| Situation                                             | OK?      | Warum                         |
| ----------------------------------------------------- | -------- | ----------------------------- |
| Consumer kurz offline (Deploy, Restart)               | Ja       | Sekunden bis Minuten Puffer   |
| Queue existiert, Service ist dauerhaft decommissioned | **Nein** | Bindings/Queue entfernen      |
| Queue existiert, Service wurde nie deployed           | **Nein** | Architekturfehler             |
| Error-Queue ohne Monitoring                           | **Nein** | Fehler akkumulieren unbemerkt |
| Queue als „Event-Archiv"                              | **Nein** | Dafür DB, Event Store, S3     |


Eine Queue **ohne Consumer**, in die weiter Messages geroutet werden, ist ein **Leck**: Producer arbeiten, Consumer nicht — RabbitMQ wird zum Müllcontainer.

Das erwartete Modell (siehe `ec.amqp` README):

> Durable quorum queue, shared across all workers. Each message is processed exactly once. If a worker goes offline, messages wait in the queue for **another worker**.

„Messages wait for another worker" — nicht „für immer, weil keiner da ist".

### Was ist legitim?

Kurzzeitig ohne Consumer ist normal und erwartet:

1. **Rolling Deploy** — Consumer kurz weg, Messages warten auf den nächsten Worker
2. **Consumer-Crash + Reconnect** — automatische Wiederverbindung (z. B. via `ec.amqp` / amqp-connection-manager)
3. **Dead-Letter-Queue** — bewusst für fehlgeschlagene Messages, **mit Monitoring und Reprocessing**

Alles darüber hinaus ist ein Bug.

### Was bei uns schief läuft

1. **Services laufen nicht**, aber Queues und Bindings existieren weiter
2. **Events werden weiter geroutet** (Federation/Event-Exchange)
3. **Keine Schutzmechanismen** — kein TTL, kein `x-max-length`, kein Alert bei `consumers=0`
4. **Error-Queues ohne Betrieb** — 142 `.errors`-Queues wachsen unbemerkt

Typisches Muster: Tenant bekommt Vhost + Queue-Bindings, Service wird nie deployed oder später abgeschaltet, niemand räumt auf.

### RabbitMQ vs. Event Store — wann was?


| Bedarf                                | Richtiges Tool                                         |
| ------------------------------------- | ------------------------------------------------------ |
| Events kurz puffern und verarbeiten   | **RabbitMQ**                                           |
| Events dauerhaft speichern / replayen | Kafka, Event Store, DB                                 |
| Fehler analysieren und reprocessen    | DLQ + Monitoring, nicht 81 verstreute `.errors`-Queues |
| Historische Daten abfragen            | Datenbank, nicht RabbitMQ                              |


### Betriebsregeln (Guidelines fürs Team)

**Regel 1: Keine Queue ohne aktiven Consumer**

Wenn ein Service nicht läuft → Bindings entfernen oder Publishing stoppen. Jede Queue mit `messages > 0` und `consumers = 0` über mehr als wenige Minuten ist ein Bug.

**Regel 2: Queue-Policies als Sicherheitsnetz**

Nicht als Ersatz für Consumer, sondern als Absicherung gegen Wiederholung:

- `x-message-ttl` — alte Messages verfallen (z. B. 24–72h)
- `x-max-length` — Queue darf nicht unbegrenzt wachsen
- Dead-Letter-Exchange — abgelaufene/überlaufene Messages landen kontrolliert

**Regel 3: Monitoring & Alerting**

Alert wenn:

- `messages_ready > 0` und `consumers = 0` für > X Minuten
- Queue-Tiefe über Schwellwert
- Error-Queue wächst

**Regel 4: Lifecycle-Management**


| Ereignis             | Aktion                                   |
| -------------------- | ---------------------------------------- |
| Tenant-Onboarding    | Queue + Consumer + Binding anlegen       |
| Tenant-Offboarding   | Bindings entfernen, Queue purgen/löschen |
| Service-Decommission | Bindings löschen, Queue purgen/löschen   |


**Regel 5: RabbitMQ ist kein Archiv**

> Jede Queue mit Messages und `consumers=0` ist ein Bug — entweder Consumer starten, Bindings entfernen, oder Messages purgen. RabbitMQ ist kein Archiv.

---

## Empfohlene Actions fürs Team

### Sofort (Prio 1)

1. `**appsite-backend.course-management-service**` — Warum kein Consumer auf 43 Tenants? Service deployen oder Queue-Bindings entfernen.
2. `**HansefitCloudConnector.CheckinOutEvents**` — Ist Hansefit auf 10 Tenants aktiv? Wenn nein: Bindings entfernen.

### Kurzfristig (Prio 2)

1. **Error-Queues** — Alerting einrichten + regelmäßiges Reprocessing oder Purging.
2. **Alte Messages purgen** — Events von Mai/Juni sind vermutlich wertlos. Vor dem Purge mit Teams klären.
3. `**admin-center` Event-Collector** — Forwarder-Queues ohne Consumer prüfen.

### Mittelfristig (Prio 3) — strukturelle Verbesserungen

1. **Queue-Policies** — `x-message-ttl` oder `x-max-length` + Dead-Letter-Exchange (siehe Regel 2).
2. **Consumer-Health-Monitoring** — Alert wenn `messages > 0` und `consumers = 0` (siehe Regel 3).
3. **Tenant-Cleanup** — Vhosts mit deaktivierten Services: Bindings entfernen (siehe Regel 4).
4. **Onboarding/Offboarding-Prozess** — Queue-Lifecycle an Tenant-Lifecycle koppeln, damit sich das nicht wiederholt.

---

## Zusammenhang mit Post-Mortem 01.07.2026

Im [Post-Mortem vom 1. Juli](post-mortem-rabbitmq-spike-2026-07-01.md) wurden bereits ähnliche Queues als „ältere, unverarbeitete Messages" erwähnt (`flgnm`, `vc5020`, `tfl`, `ebrn`). Der MembershipEvents-Batch vom 02:05 CEST wurde damals verarbeitet — die hier dokumentierten Backlogs sind **unabhängig vom Spike** und bestehen seit Wochen.

---

## Datenquelle

Analyse via RabbitMQ Management API mit Pagination (500 Queues/Page, 17.895 Queues gesamt). Message-Samples via `GET /api/queues/{vhost}/{name}/get` (ack_requeue_true). Vollständige Queue-Liste als JSON exportiert.