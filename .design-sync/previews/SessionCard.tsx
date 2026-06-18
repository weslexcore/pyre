import { SessionCard } from "@pyre/design-system";

export function Schedule() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      <SessionCard type="Social" time="Sat · 4:00 PM" price="$45" slotsLeft={6} />
      <SessionCard type="Silent" time="Sun · 7:00 AM" price="$40" slotsLeft={3} />
    </div>
  );
}

export function Guided() {
  return <SessionCard type="Guided" time="Fri · 6:30 PM" price="$55" slotsLeft={2} />;
}

export function SoldOut() {
  return <SessionCard type="Social" time="Sat · 6:00 PM" price="$45" slotsLeft={0} />;
}
