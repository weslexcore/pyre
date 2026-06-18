import { Input } from "@pyre/design-system";

export function WithLabel() {
  return (
    <div style={{ width: 280 }}>
      <Input label="Email" type="email" placeholder="you@example.com" />
    </div>
  );
}

export function Filled() {
  return (
    <div style={{ width: 280 }}>
      <Input label="Full name" defaultValue="Ada Lovelace" />
    </div>
  );
}

export function WithError() {
  return (
    <div style={{ width: 280 }}>
      <Input
        label="Email"
        type="email"
        defaultValue="not-an-email"
        error="Enter a valid email address"
      />
    </div>
  );
}

export function Plain() {
  return (
    <div style={{ width: 280 }}>
      <Input placeholder="Search sessions…" />
    </div>
  );
}
