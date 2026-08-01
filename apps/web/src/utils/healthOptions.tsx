export function healthOptions() {
  return ['unknown', 'on_track', 'at_risk', 'off_track'].map((value) => <option value={value} key={value}>{value.replace('_', ' ')}</option>);
}
