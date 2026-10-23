import { Card, DisabledActionNote, Icon, PageHeader } from '../components/ui'
import type { PageProps } from './types'

const scheduleStages = [
  ['01', 'Choose a start window', 'Select allowed days and local time.'],
  ['02', 'Select queued downloads', 'Run a selected queue when the window opens.'],
  ['03', 'Apply bandwidth rules', 'Limit transfer speed during scheduled hours.'],
]

export default function Scheduler(_props: PageProps) {
  return (
    <div>
      <PageHeader title="Scheduler" description="Plan recurring windows for downloads waiting in the queue." eyebrow="AUTOMATION" />
      <div className="scheduler-layout">
        <Card title="Schedule automation" icon="calendar">
          <div className="scheduler-state"><span className="scheduler-state-icon"><Icon name="clock" size={19} /></span><div><strong>No schedules configured</strong><p>Scheduled execution is not available in this engine version.</p></div><span className="settings-state-pill">NOT ACTIVE</span></div>
          <div className="scheduler-stages">{scheduleStages.map(([number, title, description]) => <div className="scheduler-stage" key={number}><span>{number}</span><div><strong>{title}</strong><small>{description}</small></div><Icon name="chevron-right" size={15} /></div>)}</div>
          <button type="button" className="button button-secondary" disabled title="Scheduler automation is not implemented yet"><Icon name="plus" size={16} />Create schedule</button>
        </Card>
        <aside className="scheduler-side-card"><span className="scheduler-side-icon"><Icon name="info" size={17} /></span><strong>Current queue behavior</strong><p>Downloads begin when a slot opens, or when you explicitly start a held item. There are no time-of-day rules yet.</p><a href="#/queue">Review the queue <Icon name="chevron-right" size={14} /></a></aside>
      </div>
      <DisabledActionNote />
    </div>
  )
}
