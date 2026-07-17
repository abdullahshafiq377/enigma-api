import { Types } from 'mongoose';

import { Certificate, type CertificateDoc } from '@/modules/certificate/certificate.model';

export const certificateRepository = {
  findByUserAndModule(userId: string, moduleId: string): Promise<CertificateDoc | null> {
    return Certificate.findOne({ userId, moduleId }).exec() as Promise<CertificateDoc | null>;
  },

  findByUser(userId: string): Promise<CertificateDoc[]> {
    return Certificate.find({ userId }).sort({ issuedAt: -1 }).exec() as Promise<CertificateDoc[]>;
  },

  upsert(
    userId: string,
    moduleId: string,
    data: { recipientName: string; pdfKey: string; issuedAt: Date },
  ): Promise<CertificateDoc> {
    return Certificate.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), moduleId: new Types.ObjectId(moduleId) },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec() as Promise<CertificateDoc>;
  },
};
