-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "chainError" TEXT,
ADD COLUMN     "cipher" TEXT,
ADD COLUMN     "sigAlgo" TEXT,
ADD COLUMN     "tlsVersion" TEXT,
ADD COLUMN     "weakCrypto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weakCryptoReasons" TEXT[];
