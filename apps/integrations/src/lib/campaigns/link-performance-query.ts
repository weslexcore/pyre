import { BOOKING, BOOKING_BACKFILL, PURCHASE } from './conversion-buckets';

/** Choose an entire attribution tuple from the same touch as the campaign.
 * Never combine a first-touch campaign with a later click's content. */
export function linkAttributionExpr(field: string): string {
  return `lower(coalesce(if(event = '${BOOKING_BACKFILL}',
    toString(properties.attributed_utm_${field}),
    if(notEmpty(coalesce(toString(person.properties.$initial_utm_campaign), '')),
       toString(person.properties.$initial_utm_${field}),
       if(event IN ('${BOOKING}', '${PURCHASE}'), toString(properties.attributed_utm_${field}), '')
    )), ''))`;
}

/** Extra branches share the main query's five leading columns. Existing
 * campaign and source totals stay intact; unknown link credit is reconciled. */
export function linkRollupBranches(days: number, bucket: string, events: string): string[] {
  const fields = ['source', 'medium', 'content', 'term'];
  const trafficTags = fields.map(
    (field) => `lower(coalesce(toString(properties.utm_${field}), ''))`
  );
  const aliases = fields.map((field) => `link_${field}`);
  const limit = 10000;
  return [
    `SELECT 'traffic_link' AS section,
      lower(toString(properties.utm_campaign)) AS campaign,
      event AS bucket, count() AS n, 0 AS people,
      ${trafficTags.map((expr, index) => `${expr} AS ${aliases[index]}`).join(', ')}
    FROM events
    WHERE event = '$pageview' AND notEmpty(coalesce(toString(properties.utm_campaign), ''))
      AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY campaign, bucket, ${aliases.join(', ')}
    ORDER BY n DESC LIMIT ${limit}`,
    // One link per visitor and raw campaign, using their first tagged visit
    // in this report period. This partitions the existing distinct visitors.
    `SELECT 'visitors_link' AS section, campaign, '$pageview' AS bucket,
      0 AS n, count() AS people,
      ${aliases.join(', ')}
    FROM (
      SELECT lower(toString(properties.utm_campaign)) AS campaign, person_id,
        ${trafficTags.map((expr, index) => `argMin(${expr}, tuple(timestamp, uuid)) AS ${aliases[index]}`).join(', ')}
      FROM events
      WHERE event = '$pageview' AND notEmpty(coalesce(toString(properties.utm_campaign), ''))
        AND timestamp >= now() - INTERVAL ${days} DAY
      GROUP BY campaign, person_id
    )
    GROUP BY campaign, ${aliases.join(', ')}
    ORDER BY people DESC LIMIT ${limit}`,
    `SELECT 'conversion_link' AS section,
      ${linkAttributionExpr('campaign')} AS campaign,
      ${bucket} AS bucket, count() AS n, 0 AS people,
      ${fields.map((field, index) => `${linkAttributionExpr(field)} AS ${aliases[index]}`).join(', ')}
    FROM events
    WHERE event IN (${events}) AND campaign != ''
      AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY campaign, bucket, ${aliases.join(', ')}
    ORDER BY n DESC LIMIT ${limit}`,
  ];
}
