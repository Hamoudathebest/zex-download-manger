import { Card, DisabledActionNote, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function Scheduler(_props: PageProps) {
  return (
    <div>
      <PageHeader title="Scheduler" description="Time-based download rules. Schedules are prototype-only here and are not executed without an engine." />
      <Card title="New schedule (prototype form — does not schedule anything)">
        <form
          onSubmit={(e) => e.preventDefault()}
          aria-label="Schedule form (prototype only)"
          className="grid max-w-lg gap-3"
        >
          <label className="grid gap-1">Schedule name
            <input type="text" aria-label="Schedule name" placeholder="e.g. Overnight queue" className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
          </label>
          <label className="grid gap-1">Start time
            <input type="time" aria-label="Start time" className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
          </label>
          <label className="grid gap-1">Days
            <select aria-label="Days" className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800">
              <option>Weekdays</option><option>Weekends</option><option>Every day</option>
            </select>
          </label>
          <button type="submit" disabled className="w-fit rounded-md bg-gray-300 px-3 py-2 font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-60">Save schedule (disabled in prototype)</button>
        </form>
      </Card>
      <DisabledActionNote />
    </div>
  )
}
