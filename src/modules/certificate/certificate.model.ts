import { type HydratedDocument, model, Schema, type Types } from 'mongoose';

export interface ICertificate {
  userId: Types.ObjectId;
  moduleId: Types.ObjectId;
  recipientName: string;
  issuedAt: Date;
  pdfKey?: string | undefined;
}

const certificateSchema = new Schema<ICertificate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    recipientName: { type: String, required: true },
    issuedAt: { type: Date, default: Date.now },
    pdfKey: { type: String },
  },
  { timestamps: true },
);

// One certificate per (user, module).
certificateSchema.index({ userId: 1, moduleId: 1 }, { unique: true });

export const Certificate = model<ICertificate>('Certificate', certificateSchema);
export type CertificateDoc = HydratedDocument<ICertificate> & {
  createdAt: Date;
  updatedAt: Date;
};
