/**
 * Import name → PyPI distribution name, for the common cases where the two
 * differ. The default (a name absent here and not in
 * `PYTHON_AMBIGUOUS_MODULES`) is the import name itself.
 *
 * Only the well-known mismatches are listed; anything else is guessed as its
 * own name, which is right far more often than not.
 */
export const PYTHON_DISTRIBUTIONS: Readonly<Record<string, string>> = Object.freeze({
    yaml: "pyyaml",
    PIL: "pillow",
    cv2: "opencv-python",
    bs4: "beautifulsoup4",
    sklearn: "scikit-learn",
    skimage: "scikit-image",
    dateutil: "python-dateutil",
    dotenv: "python-dotenv",
    jwt: "pyjwt",
    Crypto: "pycryptodome",
    serial: "pyserial",
    usb: "pyusb",
    magic: "python-magic",
    docx: "python-docx",
    pptx: "python-pptx",
    fitz: "pymupdf",
    gi: "pygobject",
    attr: "attrs",
    OpenSSL: "pyopenssl",
    win32api: "pywin32",
    zmq: "pyzmq",
    psycopg2: "psycopg2-binary",
    MySQLdb: "mysqlclient",
    ldap: "python-ldap",
    Levenshtein: "levenshtein",
});

/**
 * Top-level import names whose distribution cannot be guessed because several
 * unrelated packages share it (`google` is protobuf, cloud SDKs, …). They are
 * skipped rather than resolved to a wrong distribution.
 */
export const PYTHON_AMBIGUOUS_MODULES: ReadonlySet<string> = new Set(["google"]);
