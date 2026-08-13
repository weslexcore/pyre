// TypeScript types for Momence Events API response

export interface MomenceAdditionalTeacher {
  firstName: string;
  lastName: string;
}

// A teacher profile from the Momence `/Teachers` endpoint. This is where the
// practitioner bios and headshots shown on special events come from — events
// themselves only carry the teacher's name and id.
export interface MomenceTeacher {
  id: number;
  firstName: string;
  lastName: string;
  bio: string | null;
  profileImage: string | null;
  isDeleted: boolean;
}

export interface MomenceEvent {
  id: number;
  title: string;
  description: string;
  type: string;
  link: string;
  dateTime: string; // ISO 8601 format
  duration: number; // minutes
  fixedPrice: number;
  location: string;
  capacity: number;
  spotsRemaining: number;
  ticketsSold: number;
  isCancelled: boolean;
  isDeleted: boolean;
  allowWaitlist: boolean;
  published: boolean;
  teacher: string;
  originalTeacher: string;
  teacherId: number;
  originalTeacherId: number;
  additionalTeachers: MomenceAdditionalTeacher[];
  image1: string | null;
  image2: string | null;
  tags: string[];
  hostId: number;
  online: boolean;
  streamLink: string | null;
  streamPassword: string | null;
}
