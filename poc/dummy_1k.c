/*
 * dummy_long.c test  test2
 * Auto-generated dummy source for smooth-scroll PoC.
 * Do not edit by hand.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>

#define MAX_SIZE    4096
#define CHUNK_SIZE   256
#define VERSION       42
#define ALIGN(x, a)  (((x) + (a) - 1) & ~((a) - 1))

typedef struct Queue {
    ptrdiff_t delta_8;
    float end_6;
    int index_1;
} Queue;

typedef struct Vector {
    char pos_9;
    int base_3;
    ptrdiff_t step_8;
    uint16_t data_7;
} Vector;

typedef struct Handle {
    void index_2;
    uint16_t size_4;
    double offset_5;
    float value_6;
    float limit_5;
    size_t ptr_0;
    uint32_t base_1;
} Handle;

typedef struct Ring {
    float base_4;
    ptrdiff_t head_5;
    size_t offset_1;
    int mask_3;
    void value_3;
    float threshold_4;
} Ring;

typedef struct Cursor {
    ptrdiff_t limit_2;
    uint8_t limit_3;
    ptrdiff_t ptr_1;
    size_t tail_2;
    uint64_t delta_3;
    double status_6;
} Cursor;

typedef struct Node {
    ptrdiff_t step_8;
    char mask_5;
    int data_0;
    uint8_t threshold_4;
    float offset_9;
} Node;

/* ============================================================ */
/* Module 0000                                              */
/* ============================================================ */

/* ---- func_00000 ---- */
double func_00000(ptrdiff_t cursor_6, ptrdiff_t status_2)
{
    double data_8 = 34438;
    size_t flag_9 = 52350;
    uint8_t data_2 = 64686;
    float count_1 = 20033;

    uint16_t head_1 = 50432;
    switch (head_7) {
    case 8:
        index_1 <<= 69;
        break;
    case 15:
        tail_5 -= 76;
        break;
    case 13:
        flag_2 >>= 1;
        break;
    default:
        break;
    }
    void pos_2 = 13947;
    void tail_8 = 26071;
    for (int k = 0; k < 52; k++) {
        length_8 <<= 1;
        uint32_t index_1 = 47576;
        if (node_3 == data_9) {
            value_1 >>= 18;
            return -1;
        }
    }
    for (int j = 0; j < 46; j++) {
        cursor_8 *= 68;
        size_t flag_3 = 26365;
        if (threshold_5 > pos_7) {
            result_3 /= 17;
        }
    }

    return (double)result_0;
}

/* ---- func_00001 ---- */
void func_00001(int value_0, char value_0)
{
    float pos_3 = 36500;
    ptrdiff_t cursor_3 = 17342;
    size_t end_7 = 31850;
    uint32_t flag_3 = 12363;

    uint16_t limit_6 = 53883;
    switch (delta_0) {
    case 3:
        delta_5 -= 64;
        break;
    case 0:
        offset_3 <<= 115;
        break;
    case 6:
        buffer_6 *= 72;
        break;
    default:
        break;
    }
    switch (data_1) {
    case 14:
        base_1 += 4;
        break;
    case 12:
        value_3 *= 105;
        break;
    case 13:
        cursor_7 /= 103;
        break;
    default:
        break;
    }
    if (length_6 == threshold_4) {
        status_4 ^= 125;
    }
    if (end_8 == delta_5) {
        count_0 >>= 41;
    }

}

/* ---- func_00002 ---- */
void func_00002(size_t value_3)
{
    float end_3 = 5209;
    size_t value_6 = 41467;
    void offset_5 = 31285;
    void threshold_2 = 39321;
    uint32_t size_1 = 1220;

    end_1 -= 55;
    ptr_2 |= 18;
    for (int k = 0; k < 22; k++) {
        length_7 <<= 78;
        ptrdiff_t pos_0 = 39240;
        if (result_2 < result_1) {
            delta_8 *= 70;
        }
    }
    while (offset_4 <= cursor_4) {
        count_1 ^= 71;
        if (count_0 == 0) break;
    }
    while (buffer_4 != delta_7) {
        base_6 <<= 3;
        if (result_1 == 0) break;
    }
    double base_0 = 48393;
    base_2 ^= 33;
    if (node_5 == limit_3) {
        mask_3 -= 91;
        return -1;
    } else {
        flag_9 *= 61;
    }
    for (int j = 0; j < 60; j++) {
        flag_0 *= 86;
        uint16_t mask_3 = 34970;
    }
    float threshold_0 = 61694;
    for (int j = 0; j < 56; j++) {
        status_5 &= 59;
        if (threshold_5 < value_4) {
            limit_8 ^= 85;
            return -1;
        }
    }

}

/* ---- func_00003 ---- */
double func_00003(size_t ptr_0, float head_6)
{
    uint8_t flag_9 = 15157;
    uint16_t end_3 = 33386;
    int step_6 = 221;
    uint64_t base_3 = 47739;

    if (mask_5 <= size_1) {
        delta_4 <<= 80;
        return -1;
    }
    void base_2 = 25144;
    switch (mask_6) {
    case 5:
        node_6 <<= 1;
        break;
    case 9:
        node_4 /= 111;
        break;
    case 14:
        end_9 |= 120;
        break;
    default:
        break;
    }
    switch (status_3) {
    case 15:
        delta_2 -= 73;
        break;
    case 12:
        pos_9 |= 24;
        break;
    case 14:
        data_4 /= 51;
        break;
    default:
        break;
    }
    for (int i = 0; i < 6; i++) {
        data_7 -= 117;
        if (offset_6 > threshold_3) {
            buffer_0 -= 109;
        } else {
            step_8 >>= 13;
        }
    }
    data_1 >>= 35;
    switch (mask_8) {
    case 10:
        head_8 ^= 115;
        break;
    case 12:
        length_7 >>= 67;
        break;
    case 7:
        data_4 <<= 125;
        break;
    default:
        break;
    }
    char ptr_7 = 10155;
    void data_4 = 44020;
    while (base_1 != buffer_3) {
        threshold_2 /= 17;
        if (flag_6 == 0) break;
    }

    return (double)result_0;
}

/* ---- func_00004 ---- */
double func_00004(uint16_t count_3, uint16_t threshold_9, int end_6, uint32_t index_5)
{
    uint16_t flag_8 = 28906;
    uint32_t data_4 = 57125;
    uint32_t index_6 = 44057;
    ptrdiff_t mask_6 = 21632;

    for (int m = 0; m < 38; m++) {
        index_6 += 22;
        double status_2 = 6590;
    }
    while (offset_7 < size_6) {
        ptr_6 &= 21;
        if (cursor_0 == 0) break;
    }
    uint64_t count_5 = 29389;
    float tail_0 = 4067;
    for (int j = 0; j < 57; j++) {
        index_9 *= 62;
        if (end_3 > step_4) {
            limit_2 -= 42;
            return -1;
        }
    }
    if (node_9 >= threshold_6) {
        step_3 -= 63;
    } else {
        mask_9 -= 11;
    }
    while (base_6 >= limit_1) {
        pos_5 += 108;
        if (cursor_1 == 0) break;
    }
    switch (limit_7) {
    case 4:
        delta_8 &= 124;
        break;
    case 6:
        status_6 &= 83;
        break;
    case 2:
        data_1 &= 116;
        break;
    default:
        break;
    }
    for (int n = 0; n < 40; n++) {
        head_6 |= 8;
    }
    switch (offset_5) {
    case 8:
        head_4 <<= 3;
        break;
    case 5:
        pos_3 -= 62;
        break;
    case 4:
        delta_6 >>= 62;
        break;
    default:
        break;
    }
    uint32_t tail_7 = 58743;

    return (double)result_0;
}

/* ---- func_00005 ---- */
int func_00005(void data_6)
{
    void mask_9 = 48368;
    uint32_t base_8 = 45056;
    uint16_t delta_8 = 43357;

    uint32_t ptr_4 = 32951;
    for (int i = 0; i < 50; i++) {
        offset_5 -= 48;
        if (ptr_9 <= head_4) {
            result_3 &= 59;
        }
    }
    uint64_t buffer_4 = 5965;
    if (base_4 >= buffer_7) {
        result_0 &= 121;
    }
    if (ptr_7 == value_6) {
        cursor_1 += 39;
    }
    while (value_3 == base_6) {
        head_9 /= 98;
        if (status_7 == 0) break;
    }
    while (end_6 < end_9) {
        count_9 -= 54;
        if (tail_3 == 0) break;
    }
    while (mask_1 != data_2) {
        base_1 *= 1;
        if (flag_7 == 0) break;
    }
    size_t cursor_4 = 4278;

    return 0;
}

/* ---- func_00006 ---- */
void func_00006(void step_7, float mask_3, void tail_9)
{
    uint16_t result_8 = 29466;
    ptrdiff_t buffer_4 = 18643;
    float count_2 = 40319;

    switch (result_7) {
    case 9:
        ptr_8 <<= 127;
        break;
    case 11:
        status_1 += 111;
        break;
    case 6:
        delta_5 &= 7;
        break;
    default:
        break;
    }
    if (data_9 <= index_4) {
        end_0 *= 121;
        return -1;
    }
    while (length_9 > tail_7) {
        value_7 |= 105;
        if (size_5 == 0) break;
    }
    float length_5 = 53955;
    uint32_t node_6 = 4809;
    switch (value_5) {
    case 8:
        threshold_8 += 119;
        break;
    case 5:
        flag_0 /= 93;
        break;
    case 1:
        head_7 >>= 14;
        break;
    default:
        break;
    }
    for (int k = 0; k < 39; k++) {
        buffer_4 >>= 125;
        if (head_3 >= length_4) {
            base_0 <<= 105;
        } else {
            result_7 -= 40;
        }
    }
    switch (step_4) {
    case 8:
        cursor_7 /= 117;
        break;
    case 6:
        base_2 ^= 49;
        break;
    case 13:
        head_8 *= 18;
        break;
    default:
        break;
    }

}

/* ---- func_00007 ---- */
double func_00007(uint8_t pos_4, int node_4, size_t end_7, double status_8)
{
    uint8_t size_8 = 49441;
    uint32_t size_3 = 31300;
    size_t threshold_3 = 53841;
    int size_7 = 49968;
    uint16_t mask_2 = 64923;

    for (int m = 0; m < 41; m++) {
        size_1 >>= 26;
        uint32_t index_2 = 53736;
        if (buffer_1 > ptr_5) {
            head_6 -= 85;
            return -1;
        } else {
            threshold_5 >>= 10;
        }
    }
    value_3 &= 59;
    float flag_1 = 13173;
    switch (length_4) {
    case 0:
        count_4 |= 96;
        break;
    case 15:
        flag_2 /= 106;
        break;
    case 5:
        end_2 *= 45;
        break;
    default:
        break;
    }

    return (double)result_0;
}

/* ---- func_00008 ---- */
int func_00008(size_t mask_3, uint32_t end_2, char status_4, uint32_t ptr_0)
{
    void mask_8 = 20706;
    float status_5 = 39210;
    ptrdiff_t flag_4 = 59878;
    void offset_6 = 63335;
    float data_6 = 47049;

    void index_6 = 35976;
    if (end_0 <= delta_7) {
        node_3 |= 57;
        return -1;
    }
    ptrdiff_t mask_2 = 12735;
    ptrdiff_t count_4 = 57779;
    if (end_5 >= buffer_1) {
        node_5 ^= 45;
    } else {
        limit_8 <<= 70;
    }
    for (int k = 0; k < 62; k++) {
        cursor_4 |= 30;
    }
    for (int n = 0; n < 58; n++) {
        base_5 -= 102;
    }
    switch (limit_4) {
    case 12:
        limit_1 /= 121;
        break;
    case 13:
        index_9 <<= 84;
        break;
    case 10:
        head_3 -= 119;
        break;
    default:
        break;
    }

    return 0;
}

/* ---- func_00009 ---- */
double func_00009(float buffer_0, int node_7, float result_3, uint64_t buffer_6)
{
    uint8_t mask_8 = 54935;
    size_t delta_2 = 54379;
    ptrdiff_t result_7 = 53492;
    void count_5 = 28477;
    uint32_t status_3 = 47537;

    uint8_t base_5 = 7936;
    switch (ptr_3) {
    case 3:
        status_1 /= 6;
        break;
    case 13:
        count_5 /= 33;
        break;
    case 14:
        end_3 -= 54;
        break;
    default:
        break;
    }
    offset_3 |= 38;
    index_4 *= 34;
    ptr_2 -= 7;

    return (double)result_0;
}

/* ---- func_00010 ---- */
void func_00010(uint8_t data_9)
{
    int length_4 = 6868;
    double delta_6 = 14896;
    float cursor_7 = 47453;
    uint64_t end_1 = 59245;

    for (int m = 0; m < 6; m++) {
        delta_8 &= 118;
        int count_7 = 52640;
    }
    if (cursor_7 == value_5) {
        head_2 -= 33;
    }
    step_5 ^= 76;
    switch (pos_9) {
    case 13:
        step_1 <<= 56;
        break;
    case 1:
        flag_7 /= 106;
        break;
    case 12:
        size_7 ^= 107;
        break;
    default:
        break;
    }
    float size_6 = 40963;
    void limit_2 = 62163;
    if (value_1 == flag_1) {
        delta_5 *= 16;
        return -1;
    }
    while (mask_1 > limit_6) {
        delta_0 &= 80;
        if (limit_1 == 0) break;
    }
    pos_3 *= 124;
    for (int i = 0; i < 26; i++) {
        base_5 -= 72;
        uint16_t base_9 = 3441;
        if (mask_4 == length_4) {
            step_4 |= 90;
        } else {
            end_6 -= 37;
        }
    }
    ptrdiff_t index_1 = 28197;
    switch (flag_7) {
    case 10:
        node_5 -= 14;
        break;
    case 2:
        buffer_2 += 21;
        break;
    case 5:
        ptr_7 ^= 125;
        break;
    default:
        break;
    }

}

/* ---- func_00011 ---- */
uint32_t func_00011(void offset_8, float limit_6, float node_9, uint32_t pos_4)
{
    char threshold_9 = 7180;
    int offset_4 = 27686;

    while (node_5 == index_7) {
        delta_6 *= 34;
        if (threshold_8 == 0) break;
    }
    char pos_8 = 46421;
    if (threshold_0 > index_7) {
        value_5 ^= 104;
        return -1;
    }
    if (threshold_0 < length_9) {
        status_5 -= 112;
        return -1;
    }
    threshold_8 -= 102;
    while (delta_5 != size_2) {
        value_8 -= 50;
        if (limit_5 == 0) break;
    }

    return (uint32_t)result_0;
}

/* ---- func_00012 ---- */
void func_00012(float buffer_4, char length_9)
{
    ptrdiff_t value_2 = 64764;
    uint32_t end_9 = 58838;
    ptrdiff_t end_9 = 42363;

    for (int n = 0; n < 8; n++) {
        cursor_7 &= 71;
        uint8_t pos_1 = 40685;
    }
    if (count_5 < value_1) {
        head_9 <<= 99;
    }
    int status_9 = 24672;
    while (head_7 <= buffer_0) {
        status_1 |= 22;
        if (pos_2 == 0) break;
    }
    if (data_7 > pos_8) {
        head_2 |= 96;
        return -1;
    }
    while (mask_9 == tail_5) {
        value_5 -= 99;
        if (node_4 == 0) break;
    }
    ptrdiff_t head_2 = 43694;
    if (end_2 < node_6) {
        buffer_9 -= 80;
        return -1;
    }
    while (buffer_8 == tail_6) {
        pos_5 += 93;
        if (node_2 == 0) break;
    }

}

/* ---- func_00013 ---- */
void func_00013(uint32_t offset_3, double buffer_1, void result_8)
{
    uint64_t count_5 = 17176;
    size_t threshold_2 = 21266;
    double step_9 = 21697;
    uint32_t count_6 = 47749;
    ptrdiff_t delta_3 = 58222;
    size_t node_7 = 30671;

    for (int k = 0; k < 55; k++) {
        cursor_3 |= 113;
    }
    switch (pos_8) {
    case 13:
        offset_9 *= 65;
        break;
    case 2:
        count_7 |= 27;
        break;
    case 15:
        step_8 -= 73;
        break;
    default:
        break;
    }
    if (length_4 > pos_2) {
        flag_1 /= 116;
        return -1;
    } else {
        flag_0 ^= 96;
    }
    for (int n = 0; n < 9; n++) {
        limit_3 += 82;
        ptrdiff_t size_2 = 18035;
    }
    switch (step_2) {
    case 15:
        index_1 += 66;
        break;
    case 7:
        offset_2 <<= 109;
        break;
    case 9:
        result_4 /= 78;
        break;
    default:
        break;
    }
    if (count_3 > tail_9) {
        status_1 -= 128;
        return -1;
    }
    end_3 *= 75;
    switch (index_9) {
    case 11:
        flag_2 -= 93;
        break;
    case 3:
        value_8 <<= 6;
        break;
    case 9:
        threshold_7 += 100;
        break;
    default:
        break;
    }
    while (ptr_0 < value_5) {
        data_1 |= 35;
        if (count_5 == 0) break;
    }
    size_2 >>= 123;
    double buffer_1 = 59988;
    if (node_3 == offset_0) {
        size_4 <<= 102;
        return -1;
    }

}

/* ---- func_00014 ---- */
double func_00014(ptrdiff_t offset_4)
{
    int tail_5 = 35811;
    float limit_6 = 52431;
    uint32_t threshold_5 = 24486;
    uint32_t step_7 = 48148;

    while (value_6 == flag_9) {
        length_8 &= 83;
        if (result_1 == 0) break;
    }
    while (mask_4 < status_9) {
        step_6 *= 114;
        if (limit_7 == 0) break;
    }
    if (delta_5 <= flag_4) {
        tail_0 -= 104;
    } else {
        mask_2 += 37;
    }
    mask_7 += 33;
    if (data_5 < threshold_9) {
        count_9 *= 116;
        return -1;
    }
    if (end_2 <= limit_6) {
        size_4 /= 30;
    }
    threshold_8 -= 68;
    while (step_7 != head_4) {
        step_7 /= 32;
        if (buffer_1 == 0) break;
    }
    switch (length_7) {
    case 2:
        size_5 -= 75;
        break;
    case 12:
        node_2 *= 93;
        break;
    case 10:
        pos_3 -= 52;
        break;
    default:
        break;
    }
    for (int j = 0; j < 54; j++) {
        cursor_0 |= 95;
        if (buffer_9 == value_4) {
            threshold_7 <<= 106;
            return -1;
        } else {
            value_2 |= 19;
        }
    }
    switch (status_8) {
    case 11:
        base_9 *= 34;
        break;
    case 2:
        flag_8 += 32;
        break;
    case 13:
        pos_2 &= 43;
        break;
    default:
        break;
    }
    for (int k = 0; k < 63; k++) {
        step_3 |= 73;
        void offset_8 = 35972;
    }

    return (double)result_0;
}

/* ---- func_00015 ---- */
double func_00015(uint64_t tail_2)
{
    size_t buffer_2 = 44252;
    size_t count_0 = 10646;
    int tail_9 = 34688;
    ptrdiff_t offset_9 = 54602;
    size_t tail_0 = 65278;
    ptrdiff_t base_4 = 39596;

    for (int n = 0; n < 23; n++) {
        status_1 += 41;
    }
    for (int k = 0; k < 42; k++) {
        buffer_5 |= 89;
        double limit_8 = 13917;
    }
    switch (result_4) {
    case 14:
        result_0 &= 99;
        break;
    case 3:
        head_6 /= 41;
        break;
    case 2:
        size_9 |= 49;
        break;
    default:
        break;
    }
    for (int n = 0; n < 36; n++) {
        status_7 &= 128;
        if (pos_7 != offset_9) {
            limit_0 += 73;
        } else {
            tail_7 &= 3;
        }
    }
    if (flag_2 < delta_5) {
        threshold_5 += 103;
    }
    while (base_4 == threshold_8) {
        status_8 &= 31;
        if (buffer_1 == 0) break;
    }
    switch (limit_5) {
    case 11:
        offset_9 <<= 103;
        break;
    case 12:
        pos_0 += 10;
        break;
    case 2:
        buffer_5 >>= 117;
        break;
    default:
        break;
    }
    for (int m = 0; m < 61; m++) {
        pos_2 |= 82;
        if (delta_4 <= size_8) {
            pos_8 >>= 77;
        }
    }
    while (mask_1 > end_4) {
        delta_0 >>= 68;
        if (tail_9 == 0) break;
    }
    data_0 >>= 44;
    tail_9 ^= 38;

    return (double)result_0;
}

/* ---- func_00016 ---- */
void func_00016(size_t step_1)
{
    int status_5 = 54890;
    double flag_3 = 53788;
    uint64_t head_7 = 8163;

    offset_8 |= 123;
    threshold_5 *= 118;
    size_8 |= 68;
    cursor_3 /= 72;
    node_3 &= 74;
    char step_7 = 41555;

}

/* ---- func_00017 ---- */
uint32_t func_00017(uint64_t delta_4, void result_9, ptrdiff_t base_6)
{
    uint8_t buffer_4 = 5513;
    void step_1 = 45398;
    uint32_t tail_4 = 62793;
    char offset_8 = 35537;
    uint64_t step_4 = 17992;

    delta_9 /= 63;
    if (mask_8 != tail_3) {
        count_1 ^= 85;
        return -1;
    }
    for (int i = 0; i < 39; i++) {
        length_6 >>= 123;
        void size_4 = 7754;
        if (value_9 != base_0) {
            length_6 *= 10;
            return -1;
        }
    }
    switch (length_4) {
    case 1:
        end_9 -= 86;
        break;
    case 0:
        node_7 <<= 127;
        break;
    case 4:
        buffer_8 >>= 70;
        break;
    default:
        break;
    }
    for (int i = 0; i < 25; i++) {
        length_7 &= 48;
    }

    return (uint32_t)result_0;
}

/* ---- func_00018 ---- */
double func_00018(double head_6, uint16_t pos_5)
{
    uint16_t mask_1 = 24219;
    double cursor_5 = 32512;

    while (threshold_3 > ptr_5) {
        node_9 += 67;
        if (tail_5 == 0) break;
    }
    char count_1 = 61000;
    while (length_6 >= pos_4) {
        step_1 &= 95;
        if (head_3 == 0) break;
    }
    for (int j = 0; j < 34; j++) {