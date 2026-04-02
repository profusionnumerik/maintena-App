import type { InterventionPhoto } from "@/types/intervention-photo";

type UploadParams = {
  coProId: string;
  interventionId: string;
  existingPhotosCount: number;
  source: "library" | "camera";
};

export async function pickCompressAndUploadImage(
  _params: UploadParams
): Promise<InterventionPhoto | null> {
  return null;
}