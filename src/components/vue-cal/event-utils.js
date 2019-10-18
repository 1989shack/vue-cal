import Vue from 'vue'
import { formatDate, stringToDate, formatTime, countDays, datesInSameTimeStep } from './date-utils'
const dayMilliseconds = 24 * 3600 * 1000
const defaultEventDuration = 2 // In hours.

export const eventDefaults = {
  _eid: null,
  start: '', // Externally given formatted date & time.
  startDate: '', // Date object.
  startTimeMinutes: 0,
  end: '', // Externally given formatted date & time.
  endDate: '', // Date object.
  endTimeMinutes: 0,
  title: '',
  content: '',
  background: false,
  allDay: false,
  segments: null,
  repeat: null,
  daysCount: 1,
  deletable: true,
  deleting: false,
  resizable: true,
  resizing: false,
  focused: false,
  top: 0,
  height: 0,
  classes: []
}

// Create an event at the given date and time, and allow overriding
// event attributes through the eventOptions object.
export const createAnEvent = (dateTime, eventOptions, vuecal) => {
  if (typeof dateTime === 'string') dateTime = stringToDate(dateTime)
  if (!(dateTime instanceof Date)) return false

  const hours = dateTime.getHours()
  const minutes = dateTime.getMinutes()
  const startTimeMinutes = hours * 60 + minutes
  const hoursEnd = hours + defaultEventDuration
  const endTimeMinutes = startTimeMinutes + 120
  const formattedHours = (hours < 10 ? '0' : '') + hours
  const formattedHoursEnd = (hoursEnd < 10 ? '0' : '') + hoursEnd
  const formattedMinutes = (minutes < 10 ? '0' : '') + minutes
  const start = formatDate(dateTime, null, vuecal.texts) + (vuecal.time ? ` ${formattedHours}:${formattedMinutes}` : '')
  const end = formatDate(dateTime, null, vuecal.texts) + (vuecal.time ? ` ${formattedHoursEnd}:${formattedMinutes}` : '')

  let event = {
    ...eventDefaults,
    _eid: `${vuecal._uid}_${vuecal.eventIdIncrement++}`,
    start,
    startDate: dateTime,
    startTimeMinutes,
    end,
    endDate: new Date(end.replace(/-/g, '/')), // replace '-' with '/' for Safari.
    endTimeMinutes,
    segments: null,
    ...eventOptions
  }

  // If the onEventCreate() function is given as a parameter to vue-cal:
  // 1. give it access to the created event & the deleteAnEvent() function.
  // 2. Prevent creation of the event if this function returns false.
  if (typeof vuecal.onEventCreate === 'function') {
    if (!vuecal.onEventCreate(event, () => deleteAnEvent(event, vuecal))) return
  }

  // Check if event is a multiple day event and update days count.
  if (event.start.substr(0, 10) !== event.end.substr(0, 10)) {
    event.daysCount = countDays(event.startDate, event.endDate)
  }

  // Add event to the mutableEvents array.
  vuecal.mutableEvents.push(event)

  // Add the new event to the current view.
  // The event may have been edited on the fly to become a multiple-day event,
  // the method addEventsToView makes sure the segments are created.
  vuecal.addEventsToView([event])

  vuecal.emitWithEvent('event-create', event)
  vuecal.emitWithEvent('event-change', event)

  return event
}

export const addEventSegment = (e, vuecal) => {
  if (!e.segments) {
    Vue.set(e, 'segments', {})
    e.segments[e.start.substr(0, 10)] = {
      startDate: e.startDate,
      start: e.start.substr(0, 10),
      startTimeMinutes: e.startTimeMinutes,
      endTimeMinutes: 24 * 60,
      isFirstDay: true,
      isLastDay: false,
      height: 0,
      top: 0
    }
  }

  // Modify the last segment - which is no more the last one.
  let previousSegment = e.segments[formatDate(e.endDate, null, vuecal.texts)]
  // previousSegment might not exist when dragging too fast, prevent errors.
  if (previousSegment) {
    previousSegment.isLastDay = false
    previousSegment.endTimeMinutes = 24 * 60
  }
  else {
    // @todo: when moving fast might lose the previousSegment.
    // Trying to update it would then result in an error, but do nothing would create a visual bug.
  }

  // Create the new last segment.
  const startDate = e.endDate.addDays(1)
  const endDate = new Date(startDate)
  const formattedDate = formatDate(startDate, null, vuecal.texts)
  startDate.setHours(0, 0)
  e.segments[formattedDate] = {
    startDate,
    start: formattedDate,
    startTimeMinutes: 0,
    endTimeMinutes: e.endTimeMinutes,
    isFirstDay: false,
    isLastDay: true,
    height: 0,
    top: 0
  }

  e.daysCount = Object.keys(e.segments).length
  e.endDate = endDate
  e.end = `${formattedDate} ${formatTime(e.endTimeMinutes)}`

  return formattedDate
}

export const removeEventSegment = (e, vuecal) => {
  let segmentsCount = Object.keys(e.segments).length
  if (segmentsCount <= 1) return e.end.substr(0, 10)

  // Remove the last segment.
  delete e.segments[e.end.substr(0, 10)]
  segmentsCount--

  const endDate = e.endDate.subtractDays(1)
  const formattedDate = formatDate(endDate, null, vuecal.texts)
  let previousSegment = e.segments[formattedDate]

  // If no more segments, reset the segments attribute to null.
  if (!segmentsCount) e.segments = null

  // previousSegment might not exist when dragging too fast, prevent errors.
  else if (previousSegment) {
    // Modify the new last segment.
    previousSegment.isLastDay = true
    previousSegment.endTimeMinutes = e.endTimeMinutes
  }
  else {
    // @todo: when moving fast might lose the previousSegment.
    // Trying to update it would then result in an error, but do nothing would create a visual bug.
  }

  e.daysCount = segmentsCount || 1
  e.endDate = endDate
  e.end = `${formattedDate} ${formatTime(e.endTimeMinutes)}`

  return formattedDate
}

export const createEventSegments = (e, viewStartDate, viewEndDate, vuecal) => {
  const eventStart = e.startDate.getTime()
  let eventEnd = e.endDate.getTime()
  if (!e.endDate.getHours() && !e.endDate.getMinutes()) eventEnd -= 1000

  Vue.set(e, 'segments', {})

  // Create 1 segment per day in the event, but only within the current view.
  let timestamp = Math.max(viewStartDate.getTime(), eventStart)
  const end = Math.min(viewEndDate.getTime(), eventEnd)

  while (timestamp <= end) {
    const nextMidnight = (new Date(timestamp + dayMilliseconds)).setHours(0, 0, 0)
    const isFirstDay = timestamp === eventStart

    // const isLastDay = end === eventEnd && nextMidnight > end
    // @todo: testing this:
    const isLastDay = end === eventEnd && nextMidnight >= end

    const startDate = isFirstDay ? e.startDate : new Date(timestamp)
    const formattedDate = isFirstDay ? e.start.substr(0, 10) : formatDate(startDate, null, vuecal.texts)

    e.segments[formattedDate] = {
      startDate,
      start: formattedDate,
      startTimeMinutes: isFirstDay ? e.startTimeMinutes : 0,
      endTimeMinutes: isLastDay ? e.endTimeMinutes : (24 * 60),
      isFirstDay,
      isLastDay,
      height: 0,
      top: 0
    }

    timestamp = nextMidnight
  }

  return e
}

export const deleteAnEvent = (event, vuecal) => {
  vuecal.emitWithEvent('event-delete', event)

  // Delete the event globally.
  vuecal.mutableEvents = vuecal.mutableEvents.filter(e => e._eid !== event._eid)
  // Delete the event from the current view.
  // checkCellOverlappingEvents() will be re-run automatically from the cell computed events.
  vuecal.view.events = vuecal.view.events.filter(e => e._eid !== event._eid)
}

// EVENT OVERLAPS.
// ===================================================================
// Only for the current view, recreated on view change.
let comparisonArray, cellOverlaps
// Will recalculate all the overlaps of the current cell OR split.
// cellEvents will contain only the current split events if in a split.
export const checkCellOverlappingEvents = (cellEvents, options) => {
  comparisonArray = cellEvents.slice(0)
  cellOverlaps = {}

  // Can't filter background events before calling this function otherwise
  // when an event is changed to background it would not update its previous overlaps.
  cellEvents.forEach(e => {
    // For performance, never compare the current event in the next loops.
    // The array is smaller and smaller as we loop.
    comparisonArray.shift()

    if (!cellOverlaps[e._eid]) Vue.set(cellOverlaps, e._eid, { overlaps: [], start: e.start, position: 0 })
    cellOverlaps[e._eid].position = 0

    comparisonArray.forEach(e2 => {
      if (!cellOverlaps[e2._eid]) Vue.set(cellOverlaps, e2._eid, { overlaps: [], start: e2.start, position: 0 })

      const eventIsInRange = eventInRange(e2, e.startDate, e.endDate)
      const eventsInSameTimeStep = options.overlapsPerTimeStep ? datesInSameTimeStep(e.startDate, e2.startDate, options.timeStep) : 1
      // Add to the overlaps array if overlapping.
      if (!e.background && !e.allDay && !e2.background && !e2.allDay && eventIsInRange && eventsInSameTimeStep) {
        cellOverlaps[e._eid].overlaps.push(e2._eid)
        cellOverlaps[e._eid].overlaps = [...new Set(cellOverlaps[e._eid].overlaps)] // Dedupe, most performant way.

        cellOverlaps[e2._eid].overlaps.push(e._eid)
        cellOverlaps[e2._eid].overlaps = [...new Set(cellOverlaps[e2._eid].overlaps)] // Dedupe, most performant way.
        cellOverlaps[e2._eid].position++
      }
      // Remove from the overlaps array if not overlapping or if 1 of the 2 events is background or all-day long.
      else {
        let pos1, pos2
        if ((pos1 = (cellOverlaps[e._eid] || { overlaps: [] }).overlaps.indexOf(e2._eid)) > -1) cellOverlaps[e._eid].overlaps.splice(pos1, 1)
        if ((pos2 = (cellOverlaps[e2._eid] || { overlaps: [] }).overlaps.indexOf(e._eid)) > -1) cellOverlaps[e2._eid].overlaps.splice(pos2, 1)
        cellOverlaps[e2._eid].position--
      }
    })
  })

  // Overlaps streak is the longest horizontal set of simultaneous events.
  // This is determining the width of events in a streak.
  // e.g. 3 overlapping events [1, 2, 3]; 1 overlaps 2 & 3; 2 & 3 don't overlap;
  //      => streak = 2; each width = 50% not 33%.
  let longestStreak = 0
  for (const id in cellOverlaps) {
    const item = cellOverlaps[id]

    // Calculate the position of each event in current streak (determines the CSS left property).
    const overlapsRow = item.overlaps.map(id2 => ({ id: id2, start: cellOverlaps[id2].start }))
    overlapsRow.push({ id, start: item.start })
    overlapsRow.sort((a, b) => a.start < b.start ? -1 : (a.start > b.start ? 1 : (a.id > b.id ? -1 : 1)))
    item.position = overlapsRow.findIndex(e => e.id === id)

    longestStreak = Math.max(getOverlapsStreak(item, cellOverlaps), longestStreak)
  }

  return [cellOverlaps, longestStreak]
}

/**
 * Overlaps streak is the longest horizontal set of simultaneous events.
 * This is determining the width of each events in this streak.
 * E.g. 3 overlapping events [1, 2, 3]; 1 overlaps 2 & 3; 2 & 3 don't overlap;
 *      => streak = 2; each width = 50% not 33%.
 *
 * @param {Object} event The current event we are checking among all the events of the current cell.
 * @param {Object} cellOverlaps An indexed array of all the events overlaps for the current cell.
 * @return {Number} The number of simultaneous event for this event.
 */
export const getOverlapsStreak = (event, cellOverlaps = {}) => {
  let streak = event.overlaps.length + 1
  let removeFromStreak = []
  event.overlaps.forEach(id => {
    if (!removeFromStreak.includes(id)) {
      let overlapsWithoutSelf = event.overlaps.filter(id2 => id2 !== id)
      overlapsWithoutSelf.forEach(id3 => {
        if (!cellOverlaps[id3].overlaps.includes(id)) removeFromStreak.push(id3)
      })
    }
  })

  removeFromStreak = [...new Set(removeFromStreak)] // Dedupe, most performant way.
  streak -= removeFromStreak.length
  return streak
}

export const updateEventPosition = (event, vuecal) => {
  const { startTimeMinutes, endTimeMinutes } = event

  // Top of event.
  let minutesFromTop = startTimeMinutes - vuecal.timeFrom
  const top = Math.round(minutesFromTop * vuecal.timeCellHeight / vuecal.timeStep)

  // Bottom of event.
  minutesFromTop = Math.min(endTimeMinutes, vuecal.timeTo) - vuecal.timeFrom
  const bottom = Math.round(minutesFromTop * vuecal.timeCellHeight / vuecal.timeStep)

  event.top = Math.max(top, 0)
  event.height = bottom - event.top
}

/**
 * Tells whether an event is in a given date range, even partially.
 *
 * @param {Object} event The event to test.
 * @param {Date} start The start of range date object.
 * @param {Date} end The end of range date object.
 * @return {Boolean} true if in range, even partially.
 */
export const eventInRange = (event, start, end) => {
  // Check if all-day or timeless event (if date but no time there won't be a `:` in event.start).
  if (event.allDay || !event.start.includes(':')) {
    // Get the date and discard the time if any, then check it's within the date range.
    const eventStartMidnight = new Date(event.startDate).setHours(0, 0, 0, 0)
    const startMidnight = new Date(start).setHours(0, 0, 0, 0)
    const endMidnight = new Date(end).setHours(23, 59, 59, 999)
    const inRange = eventStartMidnight >= startMidnight && eventStartMidnight <= endMidnight
    return inRange || (event.repeat && recurringEventInRange(event, new Date(startMidnight), new Date(endMidnight)))
  }

  if (event.repeat) return recurringEventInRange(event, start, end)

  const startTimestamp = event.startDate.getTime()
  const endTimestamp = event.endDate.getTime()
  return startTimestamp < end.getTime() && endTimestamp > start.getTime()
}

/**
 * Tells whether a recurring event is in a given date range, even partially.
 * That means: first check the original event date, then also check if range
 * contains one of the repeated days.
 *
 * @param {Object} event The event to test.
 * @param {Date} start The start of range date object.
 * @param {Date} end The end of range date object.
 * @return {Boolean} true if in range, even partially.
 */
export const recurringEventInRange = (event, start, end) => {
  // Event starts after the given range.
  if (end.getTime() <= event.startDate.getTime()) return false

  const endTimestamp = Math.min(end.getTime(), event.repeat.until ? (new Date(event.repeat.until)).getTime() : Infinity)
  const eventMonthDate = event.startDate.getDate()
  const eventMonth = event.startDate.getMonth()
  let tmpDate = start
  // For each day of the range, find if the current event is repeated within this day.
  // E.g. if the range contains a weekday of the event weekdays repeat array.
  while (tmpDate.getTime() < endTimestamp) {
    // This list of cases don't waste execution time:
    // The JS does not execute the remainder of each condition if first part fails (e.g. `event.repeat.weekdays &&`).
    const repeatWeekdays = event.repeat.weekdays && event.repeat.weekdays.includes(tmpDate.getDay() || 7)
    const repeatMonth = event.repeat.every === 'month' && eventMonthDate === tmpDate.getDate()
    const repeatYear = event.repeat.every === 'year' && eventMonthDate === tmpDate.getDate() && eventMonth === tmpDate.getMonth()
    if (repeatWeekdays || repeatMonth || repeatYear) return true
    tmpDate = tmpDate.addDays(1)
  }
}
