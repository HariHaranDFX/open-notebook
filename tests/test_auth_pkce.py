import base64
import hashlib

from api.auth.pkce import generate_challenge, generate_state, generate_verifier


def test_generate_verifier_meets_rfc7636_length():
    verifier = generate_verifier()

    assert 43 <= len(verifier) <= 128
    assert all(c.isalnum() or c in "-._~" for c in verifier)


def test_generate_verifier_is_unique_per_call():
    assert generate_verifier() != generate_verifier()


def test_generate_challenge_is_s256_of_verifier():
    verifier = generate_verifier()

    challenge = generate_challenge(verifier)

    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    assert challenge == expected
    assert "=" not in challenge


def test_generate_state_is_unique_per_call():
    assert generate_state() != generate_state()
