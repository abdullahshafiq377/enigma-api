import { Types } from 'mongoose';

import { buildCertificatePdf } from '@/modules/certificate/certificate.pdf';
import { certificateRepository } from '@/modules/certificate/certificate.repository';
import { isModuleComplete } from '@/modules/certificate/completion';
import { Event } from '@/modules/event/event.model';
import { mediaService } from '@/modules/media/media.service';
import { Module } from '@/modules/module/module.model';
import { progressRepository } from '@/modules/progress/progress.repository';
import { videoRepository } from '@/modules/video/video.repository';
import { ApiError } from '@/utils/ApiError';

export interface CertificateDTO {
  id: string;
  moduleId: string;
  recipientName: string;
  issuedAt: Date;
}

export const certificateService = {
  /** Generate (or return existing) certificate once every module video is complete. */
  async generate(userId: string, moduleId: string, recipientName: string): Promise<CertificateDTO> {
    const module = await Module.findById(moduleId).exec();
    if (!module) throw ApiError.notFound('Module not found');

    const videos = await videoRepository.findPublishedByModule(moduleId);
    const publishedIds = videos.map((v) => v.id);
    const completed = await progressRepository.findCompletedVideoIds(userId, publishedIds);

    if (!isModuleComplete(publishedIds, new Set(completed))) {
      throw ApiError.forbidden('Module is not yet complete');
    }

    const existing = await certificateRepository.findByUserAndModule(userId, moduleId);
    if (existing?.pdfKey) {
      return {
        id: existing.id,
        moduleId,
        recipientName: existing.recipientName,
        issuedAt: existing.issuedAt,
      };
    }

    const issuedAt = new Date();
    const pdf = await buildCertificatePdf({
      recipientName,
      moduleTitle: module.title,
      dateStr: issuedAt.toISOString().slice(0, 10),
    });

    const pdfKey = `certificates/${userId}/${moduleId}.pdf`;
    await mediaService.uploadObject(pdfKey, pdf, 'application/pdf');

    const cert = await certificateRepository.upsert(userId, moduleId, {
      recipientName,
      pdfKey,
      issuedAt,
    });
    return { id: cert.id, moduleId, recipientName: cert.recipientName, issuedAt: cert.issuedAt };
  },

  async listMine(userId: string): Promise<CertificateDTO[]> {
    const certs = await certificateRepository.findByUser(userId);
    return certs.map((c) => ({
      id: c.id,
      moduleId: c.moduleId.toString(),
      recipientName: c.recipientName,
      issuedAt: c.issuedAt,
    }));
  },

  /** Presigned download URL for a completed certificate. Logs a download event for analytics. */
  async getDownloadUrl(userId: string, moduleId: string): Promise<string> {
    const cert = await certificateRepository.findByUserAndModule(userId, moduleId);
    if (!cert?.pdfKey) throw ApiError.notFound('Certificate not found');
    await Event.create({
      userId: new Types.ObjectId(userId),
      type: 'cert_download',
      at: new Date(),
      meta: { moduleId },
    });
    return mediaService.getDownloadUrl(cert.pdfKey);
  },
};
