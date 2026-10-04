// Keeps the path and the parameter names of a request URL but drops every
// value. Query strings carry what people type into search boxes — customer
// names, phones, e-mails — and none of that belongs in a log.
export function redactUrlQuery(url: string | undefined): string {
  if (!url) {
    return '';
  }
  const queryStart = url.indexOf('?');
  if (queryStart === -1) {
    return url;
  }
  const names = url
    .slice(queryStart + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => `${pair.split('=')[0]}=[REDACTED]`);
  return names.length > 0 ? `${url.slice(0, queryStart)}?${names.join('&')}` : url.slice(0, queryStart);
}
