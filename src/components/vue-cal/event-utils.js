import Vue from 'vue'
import { formatDateLite, stringToDate, formatTime, countDays, datesInSameTimeStep } from './date-utils'

const defaultEventDuration = 2 // In hours.
const minutesInADay = 24 * 60 // Don't do the maths every time.
// This is an approximation, it will not work with DLS time.
// const approxDayMilliseconds = minutesInADay * 60 * 1000
// This is an approximate minimum we can get in a year. Purposely stay bellow 365 but close.
// const minYearMilliseconds = 364 * approxDayMilliseconds // Don't do the maths every time.

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
  draggable: true,
  dragging: false,
  focused: false,
  top: 0,
  height: 0,
  classes: []
}

/**
 * Create an event at the given date and time, and allow overriding
 * event attributes through the eventOptions object.
 *
 * @param {Date | String} dateTime The date and time of the new event start.
 * @param {Object} eventOptions some options to override the `eventDefaults` - optional.
 * @param {Object} vuecal the vuecal main component, to access needed methods, props, etc.
 */
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
  const start = formatDateLite(dateTime) + (vuecal.time ? ` ${formattedHours}:${formattedMinutes}` : '')
  const end = formatDateLite(dateTime) + (vuecal.time ? ` ${formattedHoursEnd}:${formattedMinutes}` : '')

  const event = {
    ...eventDefaults,
    _eid: `${vuecal._uid}_${vuecal.eventIdIncrement++}`,
    start,
    startDate: dateTime,
    startTimeMinutes,
    end,
    endDate: stringToDate(end),
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

/**
 * Add an event segment (= day) to a multiple-day event.
 *
 * @param {Object} e the multiple-day event to add segment in.
 */
export const addEventSegment = e => {
  if (!e.segments) {
    Vue.set(e, 'segments', {})
    e.segments[e.start.substr(0, 10)] = {
      startDate: e.startDate,
      start: e.start.substr(0, 10),
      startTimeMinutes: e.startTimeMinutes,
      endTimeMinutes: minutesInADay,
      isFirstDay: true,
      isLastDay: false,
      height: 0,
      top: 0
    }
  }

  // Modify the last segment - which is no more the last one.
  const previousSegment = e.segments[formatDateLite(e.endDate)]
  // previousSegment might not exist when dragging too fast, prevent errors.
  if (previousSegment) {
    previousSegment.isLastDay = false
    previousSegment.endTimeMinutes = minutesInADay
  }
  else {
    // @todo: when moving fast might lose the previousSegment.
    // Trying to update it would then result in an error, but do nothing would create a visual bug.
  }

  // Create the new last segment.
  const startDate = e.endDate.addDays(1)
  const endDate = new Date(startDate)
  const formattedDate = formatDateLite(startDate)
  startDate.setHours(0, 0, 0, 0)
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

/**
 * Remove an event segment (= day) from a multiple-day event.
 *
 * @param {Object} e the multiple-day event to remove segments from.
 */
export const removeEventSegment = e => {
  let segmentsCount = Object.keys(e.segments).length
  if (segmentsCount <= 1) return e.end.substr(0, 10)

  // Remove the last segment.
  delete e.segments[e.end.substr(0, 10)]
  segmentsCount--

  const endDate = e.endDate.subtractDays(1)
  const formattedDate = formatDateLite(endDate)
  const previousSegment = e.segments[formattedDate]

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

/**
 * Create 1 segment per day of the given event, but only within the current view.
 * (It won't create segments for all the days in view that are not in the event!)
 *
 * An event segment is a piece of event per day that contains more day-specific data.
 *
 * @param {Object} e the multiple-day event to create segments for.
 * @param {Date} viewStartDate the starting date of the view.
 * @param {Date} viewEndDate the ending date of the view.
 * @param {Object} vuecal the vuecal main component, to access needed methods, props, etc.
 */
export const createEventSegments = (e, viewStartDate, viewEndDate) => {
  const viewStartTimestamp = viewStartDate.getTime()
  const viewEndTimestamp = viewEndDate.getTime()
  let eventStart = e.startDate.getTime()
  let eventEnd = e.endDate.getTime()
  let repeatedEventStartFound = false
  let timestamp, end, eventStartAtMidnight

  // @todo: I don't think we still need that:
  // Removing 1 sec when ending at 00:00, so that we don't create a segment for nothing on last day.
  if (!e.endDate.getHours() && !e.endDate.getMinutes()) eventEnd -= 1000

  Vue.set(e, 'segments', {})

  // The goal is to create 1 segment per day in the event, but only within the current view.
  if (!e.repeat) { // Simple case first.
    timestamp = Math.max(viewStartTimestamp, eventStart)
    end = Math.min(viewEndTimestamp, eventEnd)
  }
  else {
    // Start at the beginning of the range, and end at soonest between `repeat.until` if any or range end.
    // This range will most likely be too large (e.g. whole week) and we need to narrow it
    // down in the while loop bellow.
    // We must not create unused segments, it would break the render or result in weird behaviors.
    timestamp = viewStartTimestamp
    end = Math.min(
      viewEndTimestamp,
      e.repeat.until ? stringToDate(e.repeat.until).getTime() : viewEndTimestamp
    )
  }

  while (timestamp <= end) {
    let createSegment = false
    // Be careful not to simply add 24 hours!
    // In case of DLS, that would cause the event to never end and browser to hang.
    // So use `addDays(1)` instead.
    const nextMidnight = (new Date(timestamp).addDays(1)).setHours(0, 0, 0, 0)
    let isFirstDay, isLastDay, startDate, formattedDate

    if (e.repeat) {
      const tmpDate = new Date(timestamp)
      const tmpDateFormatted = formatDateLite(tmpDate)
      // If the current day in loop is a known date of the repeated event (in `e.occurrences`),
      // then we found the first day of the event repetition, now update the `eventStart` and
      // the end of the loop at current day + event days count.
      if (repeatedEventStartFound || (e.occurrences && e.occurrences[tmpDateFormatted])) {
        if (!repeatedEventStartFound) {
          eventStart = e.occurrences[tmpDateFormatted].start
          eventStartAtMidnight = new Date(eventStart).setHours(0, 0, 0, 0)
          eventEnd = e.occurrences[tmpDateFormatted].end
        }
        repeatedEventStartFound = true
        createSegment = true
      }

      isFirstDay = timestamp === eventStartAtMidnight
      isLastDay = tmpDateFormatted === formatDateLite(new Date(eventEnd))
      startDate = isFirstDay ? new Date(eventStart) : new Date(timestamp)
      formattedDate = formatDateLite(startDate)
      // We want to find any potential other repetition of event in same range.
      if (isLastDay) repeatedEventStartFound = false
    }
    else {
      createSegment = true
      isFirstDay = timestamp === eventStart
      isLastDay = end === eventEnd && nextMidnight > end
      startDate = isFirstDay ? e.startDate : new Date(timestamp)
      formattedDate = isFirstDay ? e.start.substr(0, 10) : formatDateLite(startDate)
    }

    if (createSegment) {
      e.segments[formattedDate] = {
        startDate,
        start: formattedDate,
        startTimeMinutes: isFirstDay ? e.startTimeMinutes : 0,
        endTimeMinutes: isLastDay ? e.endTimeMinutes : minutesInADay,
        isFirstDay,
        isLastDay,
        height: 0,
        top: 0
      }
    }

    timestamp = nextMidnight
  }

  return e
}

/**
 * Delete an event.
 *
 * @param {Object} event the calendar event to delete.
 * @param {Object} vuecal the vuecal main component, to access needed methods, props, etc.
 */
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
      const overlapsWithoutSelf = event.overlaps.filter(id2 => id2 !== id)
      overlapsWithoutSelf.forEach(id3 => {
        if (!cellOverlaps[id3].overlaps.includes(id)) removeFromStreak.push(id3)
      })
    }
  })

  removeFromStreak = [...new Set(removeFromStreak)] // Dedupe, most performant way.
  streak -= removeFromStreak.length
  return streak
}

/**
 * Update the event top and height CSS properties of each event as long as vuecal.time is true.
 *
 * @param {Object} event The event to update position (top & height) of.
 * @param {Object} vuecal the vuecal main component, to access needed methods, props, etc.
 */
export const updateEventPosition = (event, vuecal) => {
  const { startTimeMinutes, endTimeMinutes } = event

  // if (event.dragging) {
  //   event.top = event.dragging.y
  //   event.left = event.dragging.x
  //   return
  // }

  // Top of event.
  let minutesFromTop = startTimeMinutes - vuecal.timeFrom
  const top = Math.round(minutesFromTop * vuecal.timeCellHeight / vuecal.timeStep)

  // Bottom of event.
  minutesFromTop = Math.min(endTimeMinutes, vuecal.timeTo) - vuecal.timeFrom
  const bottom = Math.round(minutesFromTop * vuecal.timeCellHeight / vuecal.timeStep)

  event.top = Math.max(top, 0)
  event.height = Math.max(bottom - event.top, 5) // Min height is 5px.
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
  if (event.allDay || event.start.indexOf(':') === -1) {
    // Get the date and discard the time if any, then check it's within the date range.
    const eventStart = new Date(event.startDate).setHours(0, 0, 0, 0)
    return (eventStart >= new Date(start).setHours(0, 0, 0, 0) &&
      eventStart <= new Date(end).setHours(0, 0, 0, 0))
  }

  const startTimestamp = event.startDate.getTime()
  const endTimestamp = event.endDate.getTime()
  return startTimestamp < end.getTime() && endTimestamp > start.getTime()
}
