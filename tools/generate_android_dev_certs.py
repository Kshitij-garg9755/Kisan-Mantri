from __future__ import annotations

import argparse
import ipaddress
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


ROOT = Path(__file__).resolve().parents[1]
LOCAL_CERT_DIR = ROOT / '.local-dev'
ANDROID_DEBUG_RAW = ROOT / 'android' / 'app' / 'src' / 'debug' / 'res' / 'raw'


def build_ca(now: datetime, ca_key: rsa.RSAPrivateKey) -> x509.Certificate:
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Kisan Mantri Local Development CA')])
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=825))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )


def build_server_certificate(
    now: datetime,
    address: ipaddress.IPv4Address,
    ca_key: rsa.RSAPrivateKey,
    ca_certificate: x509.Certificate,
    server_key: rsa.RSAPrivateKey,
) -> x509.Certificate:
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Kisan Mantri LAN Development Server')])
    return (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_certificate.subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=397))
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(address)]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(ca_key, hashes.SHA256())
    )


def write_private_key(path: Path, key: rsa.RSAPrivateKey) -> None:
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description='Create a local HTTPS certificate for the Kisan Mantri Android debug app.')
    parser.add_argument('ipv4', help='The laptop Wi-Fi IPv4 address used by the phone')
    args = parser.parse_args()
    address = ipaddress.ip_address(args.ipv4)
    if not isinstance(address, ipaddress.IPv4Address):
        parser.error('an IPv4 address is required')

    now = datetime.now(timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_certificate = build_ca(now, ca_key)
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server_certificate = build_server_certificate(now, address, ca_key, ca_certificate, server_key)

    LOCAL_CERT_DIR.mkdir(parents=True, exist_ok=True)
    ANDROID_DEBUG_RAW.mkdir(parents=True, exist_ok=True)
    write_private_key(LOCAL_CERT_DIR / 'ca-key.pem', ca_key)
    write_private_key(LOCAL_CERT_DIR / 'server-key.pem', server_key)
    (LOCAL_CERT_DIR / 'ca-cert.pem').write_bytes(ca_certificate.public_bytes(serialization.Encoding.PEM))
    (LOCAL_CERT_DIR / 'server-cert.pem').write_bytes(server_certificate.public_bytes(serialization.Encoding.PEM))
    (ANDROID_DEBUG_RAW / 'kisan_mantri_dev_ca.pem').write_bytes(ca_certificate.public_bytes(serialization.Encoding.PEM))
    print(f'Generated a LAN-only debug certificate for {address}.')
    print('Private keys are stored under .local-dev/ and excluded by .gitignore.')


if __name__ == '__main__':
    main()