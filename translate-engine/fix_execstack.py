"""Clear the executable-stack flag on a shared library.

CTranslate2's published wheel bundles a library whose PT_GNU_STACK program
header requests an executable stack. Linux kernels that refuse to grant it
fail the load outright:

    ImportError: libctranslate2-<hash>.so.4.5.0: cannot enable executable
    stack as shared object requires: Invalid argument

...which crash-loops the container. Nothing in this service needs an
executable stack, so clearing the request is safe and makes the library load.

Done by hand rather than with `patchelf --clear-execstack` because that option
only exists in patchelf 0.18+, which isn't what Debian or PyPI necessarily
give you — whereas flipping one bit in the ELF header always works.

Usage: python fix_execstack.py <file> [<file> ...]
"""

import struct
import sys

PT_GNU_STACK = 0x6474E551
PF_X = 0x1


def clear_execstack(path):
    """Returns True if the file was modified."""
    with open(path, "r+b") as f:
        data = bytearray(f.read())

        if data[:4] != b"\x7fELF":
            print(f"  skip (not an ELF file): {path}")
            return False
        if data[4] != 2:  # EI_CLASS: 2 = ELF64
            print(f"  skip (not 64-bit): {path}")
            return False
        if data[5] != 1:  # EI_DATA: 1 = little-endian
            print(f"  skip (not little-endian): {path}")
            return False

        e_phoff = struct.unpack_from("<Q", data, 32)[0]
        e_phentsize = struct.unpack_from("<H", data, 54)[0]
        e_phnum = struct.unpack_from("<H", data, 56)[0]

        for i in range(e_phnum):
            phdr = e_phoff + i * e_phentsize
            p_type = struct.unpack_from("<I", data, phdr)[0]
            if p_type != PT_GNU_STACK:
                continue

            flags_at = phdr + 4  # ELF64 puts p_flags right after p_type
            p_flags = struct.unpack_from("<I", data, flags_at)[0]
            if not p_flags & PF_X:
                print(f"  already clear: {path}")
                return False

            struct.pack_into("<I", data, flags_at, p_flags & ~PF_X)
            f.seek(0)
            f.write(data)
            print(f"  cleared executable stack: {path}")
            return True

        print(f"  no PT_GNU_STACK header: {path}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: fix_execstack.py <file> [<file> ...]")
    for target in sys.argv[1:]:
        clear_execstack(target)
