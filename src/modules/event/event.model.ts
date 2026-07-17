import { type HydratedDocument, model, Schema, type Types } from 'mongoose';

export const EVENT_TYPES = ['heartbeat', 'complete', 'cert_download'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Analytics events feeding the admin dashboard (activity timeline, counters). */
export interface IEvent {
  userId: Types.ObjectId;
  videoId?: Types.ObjectId | undefined;
  type: EventType;
  at: Date;
  meta?: Record<string, unknown> | undefined;
}

const eventSchema = new Schema<IEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    videoId: { type: Schema.Types.ObjectId, ref: 'Video' },
    type: { type: String, enum: EVENT_TYPES, required: true, index: true },
    at: { type: Date, default: Date.now, index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const Event = model<IEvent>('Event', eventSchema);
export type EventDoc = HydratedDocument<IEvent> & { createdAt: Date; updatedAt: Date };
