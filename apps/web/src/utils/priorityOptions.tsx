export function priorityOptions() {
  return ['none', 'low', 'medium', 'high', 'urgent'].map((value) => <option value={value} key={value}>{value}</option>);
}
