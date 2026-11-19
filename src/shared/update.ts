/** A release newer than the running app, as the check API announced it */
export interface AvailableUpdate {
  version: string
  /** Where to download it */
  url: string
}
